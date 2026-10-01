#!/usr/bin/env python3
"""
prepare_mmi_infrastructure.py

Transforms raw university-wide equipment export (Windows-1257, semicolon-delimited)
into the MMI-LIMS production CSV import format (UTF-8, RFC 4180 comma-delimited).

Features:
- Filters for Medžiagų mokslo institutas (MMI) equipment (76 tools)
- Assigns clean functional scientific categories
- Enforces equipment name length constraints (<= 100 chars) with complete model titles
- Assembles rich, comprehensive descriptions (specs, applications, inventory #, rates, responsible)
- Standardizes room locations with laboratory fallback
- Sets appropriate license requirements (true for specialized equipment, false for passive/prep tools)
- Outputs RFC 4180 compliant CSV strictly matching infrastructure_template.csv
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
    # Normalize unicode whitespace and strip
    text = str(val).strip()
    text = re.sub(r'[\r\n\t]+', ' ', text)
    text = re.sub(r'\s{2,}', ' ', text)
    return text

def parse_room(raw_patalpa, raw_lab):
    """
    Standardize location from room string (e.g. 'XVI r. (9C8b) - A115')
    and laboratory name.
    """
    lab_en = LAB_TRANSLATIONS.get(raw_lab.strip(), raw_lab.strip())
    
    if not raw_patalpa or not raw_patalpa.strip():
        return f'{lab_en}, MMI'
    
    patalpa = raw_patalpa.strip()
    # Extract room code like 'A115', 'A230', etc.
    match = re.search(r'-\s*([A-Za-z0-9]+)', patalpa)
    if match:
        room_code = match.group(1)
        return f'Room {room_code} ({lab_en})'
    
    return f'{patalpa} ({lab_en})'

def assign_category(inv, name_en, name_lt, desc_en):
    full_text = f'{name_en} {name_lt} {desc_en}'.lower()

    # 1. Lithography & Patterning
    if any(k in full_text for k in ['ebl', 'raith', 'mask aligner', 'lithograph', 'litografij', 'nanoimprint', 'microimprint', 'vinyl cutter']):
        if 'afm' in full_text:
            return 'Electron & Scanning Probe Microscopy'
        return 'Lithography & Patterning'

    # 2. Electron & Scanning Probe Microscopy
    if any(k in full_text for k in ['quanta 200', 'nanowizard', 'nt-206', 'atomic force', 'scanning electron', 'sem:']):
        return 'Electron & Scanning Probe Microscopy'

    # 3. Surface Chemical Analysis & XRD
    if any(k in full_text for k in ['xps', 'x-ray photoelectron', 'auger', 'diffractometer', 'd8 discover', 'xrd', 'quantax', 'eds', 'mass spectrometer', 'omnistar']):
        return 'Surface Chemical Analysis & XRD'

    # 4. Optical Microscopy & Profilometry
    if any(k in full_text for k in ['profilometer', 'profilometr', 'dektak', 'nikon', 'optical microscope', 'drop shape', 'tr200', 'surface roughness', 'beam profiler', 'optika']):
        return 'Optical Microscopy & Profilometry'

    # 5. Spectroscopy & Optical Analysis
    if any(k in full_text for k in ['spectrometer', 'spektrometr', 'spectroscop', 'ellipsometer', 'elipsometr', 'raman', 'ftir', 'superk', 'supercontinuum', 'monochromator', 'nova ii', 'laser power', 'crystalaser', 'perkin elmer', 'yokogawa', 'cma 012', 'avaspec', 'light source']):
        return 'Spectroscopy & Optical Analysis'

    # 6. Mechanical & Physical Testing
    if any(k in full_text for k in ['fischerscope', 'microhardness', 'rockwell', 'kietumo', 'glossmeter', 'sclerometer', 'elcometer', 'zetasizer', 'salt spray', 'thermometer', 'ut302d']):
        return 'Mechanical & Physical Testing'

    # 7. Etching & Thin Film Deposition
    if any(k in full_text for k in ['apex slr', 'pk-2430', 'rie', 'pecvd', 'mpcvd', 'usi-ionic', 'ion beam etching', 'ion beam synthesis', 'magnetron', 'lh a700', 'evaporator', 'garinimo', 'cubivap', 'ybh-71d3', 'cyrannus', 'mbe', 'kratos']):
        return 'Etching & Thin Film Deposition'

    # 8. Electrical & Device Characterization
    if any(k in full_text for k in ['keithley', '6487', 'oscilloscope', 'sds6104a', 'impedance', 'alpha-ak', 'four-point', 'solar spectrum simulator', 'electrical measurement', '3d printer', 'alfawise', 'laser marking', 'reaying']):
        return 'Electrical & Device Characterization'

    # 9. Materials Synthesis & Sample Preparation
    if any(k in full_text for k in ['spin coat', 'slot die', 'ossila', 'polos', 'chemat', 'mixer', 'dopag', 'thinky', 'furnace', 'novotherm', 'oven', 'vacucenter', 'rotary evaporator', 'scilogex', 'centrifuge', 'colo lace', 'langmuir', 'galvanoplasty', 'capa', 'adhesion layer', 'msm-1', 'induction heater']):
        return 'Materials Synthesis & Sample Preparation'

    return 'General Laboratory & Characterization'

def clean_equipment_name(inv, name_en, name_lt):
    """
    Returns an informative, polished equipment name under 100 characters.
    Handles known truncated English items and shortens excessively long titles.
    """
    # Specific known fixes for items truncated in KTU export
    if inv == 'KT1188027M' or name_en.strip() == 'Optical':
        return 'Optical & Fluorescence Microscopes - OPTIKA B-600 MET & B-353FL'
    if inv == 'KT1100092M' or name_en.strip() == 'Fiber optic spectrometer':
        return 'Fiber Optic Spectrometer & Light Source - Avantes AvaSpec-2048 & AvaLight'
    if inv == 'KT1099937M' and name_en.strip() == 'Spin coater':
        return 'Thin Layer Deposition Spin Coater'
    
    # Specific streamlined versions of names that exceed 100 chars
    if 'Supercontinuum fiber laser platform' in name_en:
        return 'Supercontinuum Laser Platform - NKT Photonics SuperK EVO HP & VARIA'
    if 'ESCALAB 250Xi' in name_en:
        return 'XPS: X-Ray Photoelectron Spectrometer - Thermo Scientific ESCALAB 250Xi'
    if 'PK-2430' in name_en:
        return 'RIE/PECVD: Reactive Ion Etching & Plasma Deposition - PlasmaTherm PK-2430'

    name = name_en.strip() if name_en.strip() else name_lt.strip()
    # Normalize dashes and double spaces
    name = re.sub(r'\s+', ' ', name)
    name = name.replace('', '')

    if len(name) > 100:
        name = name[:97] + '...'
    return name

def build_rich_description(row):
    """
    Constructs comprehensive description combining instrument overview,
    technical specifications, application fields, and lab metadata.
    """
    desc_en = clean_text(row[8])
    if not desc_en or desc_en == '-' or desc_en.lower() == 'null':
        desc_en = clean_text(row[3]) # fallback to LT
    
    spec_en = clean_text(row[7])
    if not spec_en or spec_en == '-' or spec_en.lower() == 'null':
        spec_en = clean_text(row[2]) # fallback to LT specs

    app_en = clean_text(row[9])
    if not app_en or app_en == '-' or app_en.lower() == 'null':
        app_en = clean_text(row[4])

    inv = clean_text(row[11])
    resp1 = clean_text(row[14])
    resp2 = clean_text(row[15])
    raw_rates = clean_text(row[19])
    lab_lt = clean_text(row[16])
    lab_en = LAB_TRANSLATIONS.get(lab_lt, lab_lt)

    # Format hourly rates nicely
    rates_formatted = ''
    if raw_rates:
        # e.g. "Isores: 19.01 Padaliniui: 0.05 KTU Padaliniams: 10.50"
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

    sections = []
    
    # Overview
    if desc_en:
        sections.append(desc_en)
    
    # Specs & Applications
    spec_parts = []
    if spec_en:
        spec_parts.append(f'Specs: {spec_en}')
    if app_en:
        spec_parts.append(f'Applications: {app_en}')
    if spec_parts:
        sections.append('\n'.join(spec_parts))

    # Operational Metadata block
    meta_parts = []
    if inv:
        meta_parts.append(f'Inv. No: {inv}')
    
    resps = ', '.join(filter(None, [resp1, resp2]))
    if resps:
        meta_parts.append(f'Responsible: {resps}')
    
    if rates_formatted:
        meta_parts.append(f'Rates: {rates_formatted}')
        
    meta_parts.append(f'Lab: {lab_en}')

    sections.append(' • '.join(meta_parts))

    return '\n\n'.join(sections)

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

        name = clean_equipment_name(inv, raw_name_en, raw_name_lt)
        category = assign_category(inv, raw_name_en, raw_name_lt, raw_desc_en)
        status = 'up'  # All active research tools
        location = parse_room(raw_patalpa, raw_lab)
        
        # license_req: false for passive / simple prep tools, true for everything else
        license_req = 'false' if is_passive_tool(inv, raw_name_en, raw_name_lt) else 'true'
        
        description = build_rich_description(r)
        image_url = ''

        # Quality assertions
        assert 2 <= len(name) <= 100, f'Row {idx}: Name length {len(name)} invalid: {name}'
        assert len(category) > 0, f'Row {idx}: Missing category'
        assert status in ('up', 'down', 'service'), f'Row {idx}: Invalid status {status}'
        assert license_req in ('true', 'false'), f'Row {idx}: Invalid license_req {license_req}'

        record = {
            'name': name,
            'category': category,
            'status': status,
            'location': location,
            'license_req': license_req,
            'description': description,
            'image_url': image_url
        }

        if is_already_in_database(inv, raw_name_en, raw_name_lt):
            existing_preserved.append((inv, name, category))
        else:
            new_records.append(record)

    fieldnames = ['name', 'category', 'status', 'location', 'license_req', 'description', 'image_url']
    
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
        all_records.append({
            'name': name,
            'category': assign_category(inv, clean_text(r[6]), clean_text(r[0]), clean_text(r[8])),
            'status': 'up',
            'location': parse_room(clean_text(r[18]), clean_text(r[16])),
            'license_req': 'false' if is_passive_tool(inv, clean_text(r[6]), clean_text(r[0])) else 'true',
            'description': build_rich_description(r),
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
    for inv, name, cat in existing_preserved:
        print(f'  [PROTECTED / EXCLUDED] Inv: {inv} | \"{name}\" [{cat}]')

    print(f'\nSuccessfully generated primary import CSV (new tools only): {OUTPUT_FILE}')
    print(f'Total new tools to be imported: {len(new_records)}')

if __name__ == '__main__':
    main()
