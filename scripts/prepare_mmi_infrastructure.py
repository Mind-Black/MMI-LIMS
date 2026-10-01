#!/usr/bin/env python3
"""
prepare_mmi_infrastructure.py

Transforms raw university-wide equipment export (Windows-1257, semicolon-delimited)
into the MMI-LIMS production CSV import format (UTF-8, RFC 4180 comma-delimited).

Features:
- Filters for Medžiagų mokslo institutas (MMI) equipment (76 tools)
- Assigns clean functional scientific categories
- Enforces equipment name length constraints (<= 100 chars) with complete model titles
- Populates descriptions with concise, professional short description notes and hourly rates
- Strictly excludes all personal names (no responsible persons or staff)
- Standardizes room locations with laboratory fallback
- Sets appropriate license requirements (true for specialized equipment, false for passive/prep tools)
- Outputs RFC 4180 compliant CSV strictly matching infrastructure_template.csv
- Protects existing database tools from duplication / overwrite
"""

import csv
import os
import re
import sys

SOURCE_FILE = os.path.join('infrastructure_mmi', 'iranga_20261001113829.csv')
OUTPUT_FILE = os.path.join('infrastructure_mmi', 'mmi_infrastructure_import.csv')
OUTPUT_ALL_FILE = os.path.join('infrastructure_mmi', 'mmi_infrastructure_all_76.csv')

# Tools already deployed and active in the database (from user's screenshot)
# These MUST NOT be overwritten or duplicated during import.
EXISTING_DATABASE_TOOLS = {
    'KT1215432M': 'EBL: Raith e-Line Plus',
    'KT1220232M': 'Laser: FemtoLAB',
    'KT1002086M': 'SEM: FEI Quanta 200 FEG',
    'KT1214167M': 'ICPRIE: PlasmaTherm Apex SLR',
    'KT1099936M': 'Thermal Evaporation: CUBIVAP',
    'KT1099941M': 'Sputter: LH A700',
    'KT1218651M': 'Raman: Renishaw InVia',
}

def is_already_in_database(inv, name_en, name_lt):
    if inv in EXISTING_DATABASE_TOOLS:
        return True
    txt = f"{name_en} {name_lt}".lower()
    return any(k in txt for k in [
        'raith e-line plus', 'femtolab', 'quanta 200 feg',
        'apex slr', 'cubivap', 'lh a700', 'renishaw invia',
        'universal optical spectroscopy and laser microfabrication'
    ])

# Clean lab English translations for locations & metadata
LAB_TRANSLATIONS = {
    'Paviršių ir plonasluoksnių darinių mokslo laboratorija': 'Surface & Thin Film Science Lab',
    'Nano- ir mikrolitografijos mokslo laboratorija': 'Nano- & Microlithography Lab',
    'Vakuuminių ir plazminių procesų mokslo laboratorija': 'Vacuum & Plasma Processes Lab',
    'Technologijų plėtros mokslo laboratorija': 'Technology Development Lab',
    'Medžiagų mokslo institutas': 'MMI Central Facility'
}

# Tools that do not require mandatory license / authorization (passive / simple prep tools)
PASSIVE_TOOL_INVENTORIES = {
    'KT1237532M',   # Two component mixer - Dopag Micro Mix E
    'KT1237575',    # Orbital mixer - Thinky ARE-250
    'KT1255942M',   # Vinyl cutter - Roland GS-24
    'KT1271371M',   # Rotary evaporator - Scilogex RE100-Pro
    'KT1272205M',   # Centrifuge - Colo LACE16
    'KT1287007T',   # Infrared thermometer - UNI-T UT302D
    'KT1296289M',   # Glossmeter - Elcometer 480
    'KT1296290M',   # Sclerometer Hardness Tester - Elcometer 3092
    'KT1296291M',   # Pencil Hardness Tester - Elcometer 501
    'KT1100013M',   # Surface roughness measurement device - Time TR200
}

def is_passive_tool(inv, name_en, name_lt):
    if inv in PASSIVE_TOOL_INVENTORIES:
        return True
    txt = f"{name_en} {name_lt}".lower()
    return any(k in txt for k in [
        'roland gs-24', 'thinky are-250', 'micro mix e', 'scilogex re100', 'colo lace16',
        'ut302d', 'elcometer 480', 'elcometer 3092', 'elcometer 501', 'time tr200'
    ])

def clean_text(val):
    if not val:
        return ''
    text = str(val).strip()
    text = re.sub(r'[\r\n\t]+', ' ', text)
    text = re.sub(r'\s{2,}', ' ', text)
    return text

def parse_room(raw_patalpa, raw_lab):
    lab_en = LAB_TRANSLATIONS.get(raw_lab.strip(), raw_lab.strip())
    
    if not raw_patalpa or not raw_patalpa.strip():
        return f'{lab_en}, MMI'
    
    patalpa = raw_patalpa.strip()
    match = re.search(r'-\s*([A-Za-z0-9]+)', patalpa)
    if match:
        room_code = match.group(1)
        return f'Room {room_code} ({lab_en})'
    
    return f'{patalpa} ({lab_en})'

def assign_category(inv, name_en, name_lt, desc_en):
    full_text = f'{name_en} {name_lt} {desc_en}'.lower()

    if any(k in full_text for k in ['ebl', 'raith', 'mask aligner', 'lithograph', 'litografij', 'nanoimprint', 'microimprint', 'vinyl cutter']):
        if 'afm' in full_text:
            return 'Electron & Scanning Probe Microscopy'
        return 'Lithography & Patterning'

    if any(k in full_text for k in ['quanta 200', 'nanowizard', 'nt-206', 'atomic force', 'scanning electron', 'sem:']):
        return 'Electron & Scanning Probe Microscopy'

    if any(k in full_text for k in ['xps', 'x-ray photoelectron', 'auger', 'diffractometer', 'd8 discover', 'xrd', 'quantax', 'eds', 'mass spectrometer', 'omnistar']):
        return 'Surface Chemical Analysis & XRD'

    if any(k in full_text for k in ['profilometer', 'profilometr', 'dektak', 'nikon', 'optical microscope', 'drop shape', 'tr200', 'surface roughness', 'beam profiler', 'optika']):
        return 'Optical Microscopy & Profilometry'

    if any(k in full_text for k in ['spectrometer', 'spektrometr', 'spectroscop', 'ellipsometer', 'elipsometr', 'raman', 'ftir', 'superk', 'supercontinuum', 'monochromator', 'nova ii', 'laser power', 'crystalaser', 'perkin elmer', 'yokogawa', 'cma 012', 'avaspec', 'light source']):
        return 'Spectroscopy & Optical Analysis'

    if any(k in full_text for k in ['fischerscope', 'microhardness', 'rockwell', 'kietumo', 'glossmeter', 'sclerometer', 'elcometer', 'zetasizer', 'salt spray', 'thermometer', 'ut302d']):
        return 'Mechanical & Physical Testing'

    if any(k in full_text for k in ['apex slr', 'pk-2430', 'rie', 'pecvd', 'mpcvd', 'usi-ionic', 'ion beam etching', 'ion beam synthesis', 'magnetron', 'lh a700', 'evaporator', 'garinimo', 'cubivap', 'ybh-71d3', 'cyrannus', 'mbe', 'kratos']):
        return 'Etching & Thin Film Deposition'

    if any(k in full_text for k in ['keithley', '6487', 'oscilloscope', 'sds6104a', 'impedance', 'alpha-ak', 'four-point', 'solar spectrum simulator', 'electrical measurement', '3d printer', 'alfawise', 'laser marking', 'reaying']):
        return 'Electrical & Device Characterization'

    if any(k in full_text for k in ['spin coat', 'slot die', 'ossila', 'polos', 'chemat', 'mixer', 'dopag', 'thinky', 'furnace', 'novotherm', 'oven', 'vacucenter', 'rotary evaporator', 'scilogex', 'centrifuge', 'colo lace', 'langmuir', 'galvanoplasty', 'capa', 'adhesion layer', 'msm-1', 'induction heater']):
        return 'Materials Synthesis & Sample Preparation'

    return 'General Laboratory & Characterization'

def clean_equipment_name(inv, name_en, name_lt):
    if inv == 'KT1188027M' or name_en.strip() == 'Optical':
        return 'Optical & Fluorescence Microscopes - OPTIKA B-600 MET & B-353FL'
    if inv == 'KT1100092M' or name_en.strip() == 'Fiber optic spectrometer':
        return 'Fiber Optic Spectrometer & Light Source - Avantes AvaSpec-2048 & AvaLight'
    if inv == 'KT1099937M' and name_en.strip() == 'Spin coater':
        return 'Thin Layer Deposition Spin Coater'
    
    if 'Supercontinuum fiber laser platform' in name_en:
        return 'Supercontinuum Laser Platform - NKT Photonics SuperK EVO HP & VARIA'
    if 'ESCALAB 250Xi' in name_en:
        return 'XPS: X-Ray Photoelectron Spectrometer - Thermo Scientific ESCALAB 250Xi'
    if 'PK-2430' in name_en:
        return 'RIE/PECVD: Reactive Ion Etching & Plasma Deposition - PlasmaTherm PK-2430'

    name = name_en.strip() if name_en.strip() else name_lt.strip()
    name = re.sub(r'\s+', ' ', name)

    if len(name) > 100:
        name = name[:97] + '...'
    return name

def assign_rate_category(raw_rates):
    """
    Assigns rate category from A to D based on the tool hourly rates:
    - Tier A (Cheapest): External <= 10 €/h (e.g. 7.44 €/h)
    - Tier B (Moderate): External 12 - 25 €/h (e.g. 12.50 - 19.01 €/h)
    - Tier C (High): External 26 - 40 €/h (e.g. 35.12 €/h)
    - Tier D (Premium): External > 40 €/h (e.g. 48.76 €/h)
    Defaults to 'A' if unspecified.
    """
    if not raw_rates:
        return 'A'
    m_iso = re.search(r'Isores:\s*([\d\.]+)', raw_rates)
    if m_iso:
        iso = float(m_iso.group(1))
        if iso >= 45.0:
            return 'D'
        if iso >= 30.0:
            return 'C'
        if iso >= 12.0:
            return 'B'
        return 'A'
    return 'A'

# Short, curated description notes for every MMI equipment item based on web search and technical specs.
# Excludes all personal names; focuses on instrument model capabilities, principles, and applications.
TOOL_DESCRIPTION_NOTES = {
    'KT1326229M': 'High-precision stylus surface profilometer for measuring surface topography, step heights, roughness, and thin-film thickness with sub-nanometer vertical resolution.',
    'KT1264793M': 'Handheld laser power and energy meter compatible with thermal, pyroelectric, and photodiode sensors for precise laser beam diagnostics.',
    'KT1324991M': 'High-sensitivity spectroscopy system featuring a 193 mm imaging spectrograph coupled with a thermoelectrically cooled EMCCD detector for low-light spectral measurements.',
    'KT1100176T': 'Precision single-wavelength (632.8 nm He-Ne) laser ellipsometer for non-destructive measurement of thin film thickness and refractive index.',
    'KT1326463M': 'Compact benchtop quadrupole mass spectrometer with heated capillary gas inlet for atmospheric pressure gas analysis and process monitoring across 1–100 amu.',
    'KT1327344M': 'Four-channel digital storage oscilloscope with 1 GHz bandwidth and 5 GSa/s real-time sampling for high-speed signal integrity and waveform diagnostics.',
    'KT1100231T': 'High-vacuum electron beam evaporation system equipped with up to 5 kW e-beam power for high-purity thermal deposition of refractory metals and dielectric thin films.',
    'KT1188026M': 'High-performance FTIR spectrometer covering 400–4000 cm⁻¹ with transmission, reflection, and ATR modes for molecular vibrational structure identification.',
    'KT1218716M': "Interference lithography system based on a Lloyd's mirror arrangement for fabricating uniform periodic sub-wavelength grating structures down to sub-500 nm periods.",
    'KT1237532M': 'Precision gear-metering and static mixing system designed for automated, bubble-free 10:1 ratio dispensing of two-component silicones like PDMS.',
    'KT1002057M': 'Automated Langmuir-Blodgett trough with microbalance surface pressure monitoring for controlled deposition of ordered molecular monolayers and multilayers.',
    'KT1100394T': 'Precision optical measuring microscope with transmitted and reflected illumination for high-fidelity linear dimensional metrology up to 1200x magnification.',
    'KT1220233M-2': 'High-resolution X-ray diffractometer (XRD) equipped with Cu anode, Göbel mirror, and Eulerian cradle for qualitative and quantitative phase, stress, and texture analysis.',
    'KT1219743M': 'Microwave plasma-enhanced chemical vapor deposition (MPCVD) system operating at 2.45 GHz for high-purity growth of diamond films, graphene, and carbon nanotubes.',
    'KT1099940M': 'Broad-beam ion beam etching (IBE) system with an 8 cm uniform processing area for anisotropic dry etching and physical patterning of thin films.',
    'KT1100225T': 'Ion beam deposition system operating at 400–1000 eV ion energy for synthesis of ultra-hard, low-friction diamond-like carbon (DLC) protective coatings.',
    'KT1100096M': 'Laser lithography system operating at 405 nm for recording high-resolution dot-matrix holograms up to 1200 dpi for security and diffractive master origination.',
    'KT1099941M': 'High-vacuum DC magnetron sputtering system with a rotatable substrate holder for uniform deposition of conductive metallic thin films.',
    'KT1099936M': 'High-vacuum thermal resistive evaporation system featuring quartz crystal thickness monitoring for uniform deposition of metals in cleanroom environments.',
    'KT1215880M': 'Cleanroom spin coater and precision hotplate system with programmable speed and acceleration profiles for uniform photoresist and polymer deposition.',
    'KT1180190M': 'Compact two-stage spin coater with Teflon-coated chamber for uniform deposition of sol-gel precursors, photoresists, and polymer thin films.',
    'KT1100093M': 'Automated dynamic microhardness and nanoindentation tester measuring hardness, elastic modulus, and creep under loads from 0.1 mN to 2000 mN.',
    'KT1100089M': 'Continuous roll-to-roll hot embossing machine for high-throughput thermal replication of diffractive optical elements and microstructures on polymer films.',
    'KT1100024M': 'Precision electroforming system for producing high-fidelity nickel shim matrices and submicron relief replication plates from photolithographic masters.',
    'KT1002058M': 'Atomic force microscope (AFM) for nanoscale surface topography mapping, roughness quantification, and scanning probe characterization of solid samples.',
    'KT1218717M': 'Continuous-wave ultraviolet diode-pumped laser emitting at 375 nm with 15 mW power for holographic exposure and optical excitation experiments.',
    'KT1099919M': 'Benchtop Rockwell hardness tester utilizing diamond cone and ball indenters with 15, 30, and 45 kgf test loads for macro-mechanical material testing.',
    'KT1099939M': 'Parallel-plate reactive ion etching (RIE) and plasma-enhanced chemical vapor deposition (PECVD) system for dry etching and thin dielectric film growth.',
    'KT1099931M': 'High-precision picoammeter and voltage source providing 10 fA current resolution and ±505 V output for ultra-sensitive electrical and I-V characterization.',
    'KT1214382M': 'Standardized AM1.5G solar simulator providing stable solar spectrum irradiation for testing photovoltaic efficiency and photoconductive response.',
    'KT1218651M': 'High-resolution confocal micro-Raman spectrometer with 532 nm and 785 nm laser excitation for chemical, structural, and nanomaterial phase identification.',
    'KT1188027M': 'Research-grade metallurgical and fluorescence optical microscope suite for reflected-light surface inspection and epi-fluorescence imaging.',
    'KT1215250M': 'High-temperature chamber and tube annealing furnace providing precision thermal processing and material crystallization up to 1200 °C.',
    'KT1099903M': 'Double-beam flame atomic absorption spectrometer (AAS) for sensitive elemental determination and trace heavy metal quantification in liquid solutions.',
    'KT1180998M': 'Broadband dielectric and impedance analyzer spanning 3 µHz to 3 MHz for characterizing dielectric permittivity, conductivity, and electrochemical impedance.',
    'KT1237575': 'Planetary centrifugal non-contact orbital mixer for simultaneous high-efficiency mixing and sub-micron bubble degassing of viscous pastes and PDMS.',
    'KT1219732M': 'Variable-angle spectroscopic ellipsometer covering UV-VIS-NIR (190–2000 nm) for determining optical constants and multi-layer thin film thicknesses.',
    'KT1100090M': 'Hot embossing thermal micro- and nanoimprint press for transferring sub-micrometer reliefs and diffraction patterns into thermoplastic polymers.',
    'KT1232353M': 'Cleanroom photolithographic mask aligner featuring near/deep-UV exposure, backside infrared (IR) alignment, and UV nanoimprint lithography capability.',
    'KT1002594M': 'Energy-dispersive X-ray spectrometer (EDS) accessory for scanning electron microscopy, offering elemental detection from boron (B) to americium (Am).',
    'KT11000697M': 'Roll-to-roll coating and finishing machine for applying pressure-sensitive adhesives and converting diffractive security films at speeds up to 6 m/min.',
    'KT1099930M': 'Fiber-optic spectrometer with combined deuterium-halogen light source for transmission, absorbance, and reflectance measurements from 172 to 1100 nm.',
    'KT1324079M': 'High-brightness supercontinuum white-light fiber laser (415–2250 nm) paired with a tunable bandpass filter for wavelength-selective optical characterization.',
    'KT1100092M': 'Compact fiber-optic UV-VIS spectrometer system (360–860 nm) with integrated light source for real-time refractive index and kinetic absorbance studies.',
    'KT1212756M': 'Cleanroom scanning probe microscope (AFM) optimized for high-resolution nanoscale topography, mechanical mapping, and electrical imaging in air and liquids.',
    'KT1263724': 'High-dynamic-range CMOS laser beam profiler for measuring beam spot size, intensity distribution, and spatial profiles from ultraviolet to near-infrared.',
    'KT1099985M': 'Ultra-high vacuum molecular beam epitaxy system with precise effusion cell flux control for atomic-layer epitaxial growth of GaAs semiconductor films.',
    'KT1099937M': 'High-speed laboratory spin coater operating up to 10,000 rpm for uniform coating of photoresists, sol-gels, and chemical precursors on planar substrates.',
    'KT1237543M': 'Optical drop shape analyzer for measuring static and dynamic contact angles, surface tension, and solid surface free energy of materials.',
    'KT1324719M': 'Dynamic and electrophoretic light scattering analyzer measuring nanoparticle size (0.3 nm to 15 µm), zeta potential, and particle concentration.',
    'KT1215432M': 'High-precision electron beam lithography (EBL) and nano-engineering workstation capable of sub-10 nm feature patterning and in-situ SEM imaging.',
    'KT1099984M': 'Multi-technique surface analysis instrument combining X-ray photoelectron spectroscopy (XPS) and Auger electron spectroscopy (AES) with dual Al/Mg anodes.',
    'KT1255942M': 'Precision desktop vinyl and polymer film cutter equipped with optical registration mark detection for rapid masking and microfluidic prototype fabrication.',
    'KT1214167M': 'Inductively coupled plasma reactive ion etching (ICP-RIE) system equipped with fluorine chemistry and cryogenic wafer cooling for deep silicon etching.',
    'KT1220232M': 'Ultrafast laser microfabrication and time-resolved optical spectroscopy workstation based on a femtosecond Yb:KGW laser with multi-harmonic beam delivery.',
    'KT1100013M': 'Portable surface roughness tester with digital LCD display for measuring Ra, Rz, Ry, and Rq roughness parameters across machined and coated surfaces.',
    'KT1002086M': 'Field emission environmental scanning electron microscope (ESEM) supporting high, low, and wet vacuum modes for high-resolution imaging of diverse materials.',
    'KT1238534M': 'Capillary force-assisted particle assembly system with in-situ dark-field optical microscopy for directed nanoscale placement of colloidal nanoparticles.',
    'KT1324737M': 'High-resolution optical spectrum analyzer covering 350 to 1200 nm with 60 dB dynamic range for precision laser spectrum and optical filter analysis.',
    'KT1215437M': 'High-performance surface analysis workstation combining monochromatic XPS, ISS, and REELS with depth profiling and micro-focused chemical imaging.',
    'KT1271371M': 'Digital rotary evaporator with automated motor lift and 5L heating bath (up to 180 °C) for efficient, gentle solvent evaporation and concentration.',
    'KT1272205M': 'High-speed benchtop laboratory centrifuge reaching 10,000 rpm (19,040 × g) for rapid phase separation, nanoparticle isolation, and chemical synthesis prep.',
    'KT1299539M': 'Accelerated salt fog corrosion test chamber with 108 L capacity for evaluating the environmental durability and corrosion resistance of coated surfaces.',
    'KT1287007T': 'Non-contact infrared thermometer with dual laser targeting and wide temperature range for fast, accurate surface thermal monitoring.',
    'KT1299537M': 'Compact LCD/SLA resin 3D printer using 405 nm UV light engine for high-resolution rapid prototyping of micro-mechanical parts and fixtures.',
    'KT1299536M': 'Industrial 30 W pulsed fiber laser marking and surface texturing system with 1064 nm wavelength and high-speed galvanometric beam scanner.',
    'KT1299538M': 'High-frequency induction heating unit operating up to 1400 °C with graphite crucible for rapid melting, heat treatment, and thermal processing of metals.',
    'KT1295396M': 'USB fiber-optic spectrometer covering 360–940 nm for rapid optical transmission, absorbance, and emission measurements in research and testing.',
    'KT1299540M': 'Collinear four-point probe electrical characterization station for measuring sheet resistance, resistivity, and I-V curves of thin conductive and semiconductor films.',
    'KT1270165M': 'Precision 50-liter vacuum drying oven with SalvisTEQ controller operating up to 200 °C for low-pressure thermal conditioning of sensitive materials.',
    'KT1298024M': 'Environmental electrical testing workstation featuring a Linkam optical stage, mass flow gas controllers, and a Keithley 2604 SourceMeter.',
    'KT1312719M': 'Industrial metallurgical microscope with brightfield, darkfield, and polarization optics and digital camera for high-contrast inspection of microstructures.',
    'KT1296289M': 'Precision triple-angle (20°/60°/85°) digital glossmeter with integrated haze measurement for non-destructive surface finish characterization.',
    'KT1296290M': 'Spring-loaded sclerometer scratch hardness tester with tungsten carbide tip (up to 30 N force) for evaluating coating scratch resistance.',
    'KT1296291M': 'Standardized Wolff-Wilborn pencil hardness tester (6B to 6H) for assessing coating hardness and scratch resistance according to ASTM D3363 and ISO 15184.',
    'KT1299530M': 'Automated digital slot die coater for scalable, uniform deposition of functional thin films, organic semiconductors, and nanoparticle dispersions.',
}

def build_tool_description(row):
    """
    Constructs clean, professional tool description containing:
    1. Short description note summarizing instrument capabilities and applications.
    2. Tool hourly rates (Department, KTU, External).
    Strictly excludes any personal names, responsible persons, and inventory numbers.
    """
    inv = clean_text(row[11])
    raw_name_en = clean_text(row[6]) if len(row) > 6 else ''
    raw_name_lt = clean_text(row[0]) if len(row) > 0 else ''
    raw_rates = clean_text(row[19]) if len(row) > 19 else ''
    
    # 1. Retrieve curated short description note
    note = TOOL_DESCRIPTION_NOTES.get(inv)
    if not note:
        # Fallback to cleaned English description if somehow missing
        desc_en = clean_text(row[8]) if len(row) > 8 else ''
        if not desc_en or desc_en == '-' or desc_en.lower() == 'null':
            desc_en = f"{raw_name_en or raw_name_lt}."
        note = desc_en
    
    # Ensure no inventory numbers or 'Inv. No' strings exist in the note
    note = re.sub(r'KT\d+[A-Za-z0-9_-]*', '', note)
    note = re.sub(r'Inv\.?\s*(No\.?)?:?\s*', '', note, flags=re.IGNORECASE).strip()
    
    # 2. Format hourly rates nicely
    rates_formatted = ''
    if raw_rates:
        m_iso = re.search(r'Isores:\s*([\d\.]+)', raw_rates)
        m_pad = re.search(r'Padaliniui:\s*([\d\.]+)', raw_rates)
        m_ktu = re.search(r'KTU Padaliniams:\s*([\d\.]+)', raw_rates)
        rate_tokens = []
        if m_pad:
            rate_tokens.append(f'Department: {m_pad.group(1)} €/h')
        if m_ktu:
            rate_tokens.append(f'KTU: {m_ktu.group(1)} €/h')
        if m_iso:
            rate_tokens.append(f'External: {m_iso.group(1)} €/h')
        if rate_tokens:
            rates_formatted = ' | '.join(rate_tokens)
        else:
            rates_formatted = raw_rates
            
    if rates_formatted:
        return f"{note}\n\nRates: {rates_formatted}"
    return note

def main():
    print(f'Reading source file: {SOURCE_FILE}')
    if not os.path.exists(SOURCE_FILE):
        print(f'Error: source file not found at {SOURCE_FILE}', file=sys.stderr)
        sys.exit(1)

    with open(SOURCE_FILE, 'r', encoding='windows-1257', errors='replace') as f:
        reader = csv.reader(f, delimiter=';')
        raw_headers = next(reader)
        rows = list(reader)

    print(f'Total university rows parsed: {len(rows)}')

    # Filter MMI rows (Medžiagų mokslo institutas)
    mmi_rows = [
        r for r in rows
        if len(r) > 17 and ('Medžiagų mokslo institutas' in r[17] or 'Medžiagų mokslo institutas' in r[16])
    ]
    print(f'Filtered MMI equipment rows: {len(mmi_rows)}')

    new_records = []
    existing_preserved = []

    for idx, r in enumerate(mmi_rows, 1):
        inv = clean_text(r[11])
        raw_name_lt = clean_text(r[0])
        raw_name_en = clean_text(r[6]) if len(r) > 6 else ''
        raw_desc_en = clean_text(r[8]) if len(r) > 8 else ''
        raw_lab = clean_text(r[16]) if len(r) > 16 else ''
        raw_patalpa = clean_text(r[18]) if len(r) > 18 else ''
        raw_rates = clean_text(r[19]) if len(r) > 19 else ''

        name = clean_equipment_name(inv, raw_name_en, raw_name_lt)
        category = assign_category(inv, raw_name_en, raw_name_lt, raw_desc_en)
        rate_category = assign_rate_category(raw_rates)
        status = 'up'  # All active research tools
        location = parse_room(raw_patalpa, raw_lab)
        
        # license_req: false for passive / simple prep tools, true for everything else
        license_req = 'false' if is_passive_tool(inv, raw_name_en, raw_name_lt) else 'true'
        
        description = build_tool_description(r)
        image_url = ''

        # Quality assertions
        assert 2 <= len(name) <= 100, f'Row {idx}: Name length {len(name)} invalid: {name}'
        assert len(category) > 0, f'Row {idx}: Missing category'
        assert rate_category in ('A', 'B', 'C', 'D'), f'Row {idx}: Invalid rate_category {rate_category}'
        assert status in ('up', 'down', 'service'), f'Row {idx}: Invalid status {status}'
        assert license_req in ('true', 'false'), f'Row {idx}: Invalid license_req {license_req}'
        assert len(description) > 0, f'Row {idx}: Missing description'
        assert not re.search(r'KT\d+', description), f'Row {idx}: Description contains inventory number: {description}'
        assert 'Responsible:' not in description, f'Row {idx}: Description contains Responsible: {description}'

        record = {
            'name': name,
            'category': category,
            'rate_category': rate_category,
            'status': status,
            'location': location,
            'license_req': license_req,
            'description': description,
            'image_url': image_url
        }

        if is_already_in_database(inv, raw_name_en, raw_name_lt):
            existing_preserved.append((inv, name, category, rate_category))
        else:
            new_records.append(record)

    fieldnames = ['name', 'category', 'rate_category', 'status', 'location', 'license_req', 'description', 'image_url']
    
    # 1. Primary Import File (New tools only - will not duplicate or overwrite existing database tools)
    with open(OUTPUT_FILE, 'w', encoding='utf-8', newline='') as f:
        writer = csv.DictWriter(
            f,
            fieldnames=fieldnames,
            quoting=csv.QUOTE_MINIMAL,
            lineterminator='\r\n'
        )
        writer.writeheader()
        writer.writerows(new_records)

    # 2. Archive File (All 76 tools)
    all_records = []
    for r in mmi_rows:
        inv = clean_text(r[11])
        name = clean_equipment_name(inv, clean_text(r[6]), clean_text(r[0]))
        r_rates = clean_text(r[19]) if len(r) > 19 else ''
        all_records.append({
            'name': name,
            'category': assign_category(inv, clean_text(r[6]), clean_text(r[0]), clean_text(r[8])),
            'rate_category': assign_rate_category(r_rates),
            'status': 'up',
            'location': parse_room(clean_text(r[18]), clean_text(r[16])),
            'license_req': 'false' if is_passive_tool(inv, clean_text(r[6]), clean_text(r[0])) else 'true',
            'description': build_tool_description(r),
            'image_url': ''
        })

    with open(OUTPUT_ALL_FILE, 'w', encoding='utf-8', newline='') as f:
        writer = csv.DictWriter(
            f,
            fieldnames=fieldnames,
            quoting=csv.QUOTE_MINIMAL,
            lineterminator='\r\n'
        )
        writer.writeheader()
        writer.writerows(all_records)
    
    print(f'\n--- DATABASE OVERWRITE PROTECTION ---')
    print(f'Preserved existing tools in database ({len(existing_preserved)}):')
    for inv, name, cat, rc in existing_preserved:
        print(f'  [PROTECTED / EXCLUDED] Inv: {inv} | \"{name}\" [{cat}] (Rate: {rc})')

    print(f'\nSuccessfully generated primary import CSV (new tools only): {OUTPUT_FILE}')
    print(f'Total new tools to be imported: {len(new_records)}')
    print(f'Successfully generated archive CSV (all 76 tools): {OUTPUT_ALL_FILE}')

if __name__ == '__main__':
    main()
