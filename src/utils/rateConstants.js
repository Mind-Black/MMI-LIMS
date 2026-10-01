/**
 * Rate category definitions and institutional pricing details for MMI equipment.
 * All rates are quoted on an hourly basis (€/h) and exclude VAT (excl. VAT / PVM neįskaičiuotas).
 * (Converted from raw university 30-minute ledger rates: hourly = 30-min rate × 2).
 */
export const RATE_TIER_DETAILS = {
    A: {
        label: 'Category A (Basic & General)',
        external: '14.88 €/h',
        ktu: '8.00 €/h',
        dept: '0.04 €/h',
        description: 'General equipment, sample prep, optical tables & basic characterization'
    },
    B: {
        label: 'Category B (Standard)',
        external: '38.02 €/h',
        ktu: '21.00 €/h',
        dept: '0.10 €/h',
        description: 'Standard analysis: Raman, profilometers, sputtering, thermal evaporation'
    },
    C: {
        label: 'Category C (Advanced)',
        external: '70.24 €/h',
        ktu: '42.00 €/h',
        dept: '0.22 €/h',
        description: 'Advanced systems: SEM, femtosecond laser micromachining, XPS, RIE/PECVD'
    },
    D: {
        label: 'Category D (Premium)',
        external: '97.52 €/h',
        ktu: '57.00 €/h',
        dept: '0.28 €/h',
        description: 'Premium nano-fabrication: Electron beam lithography (EBL), ICP-RIE'
    }
};

export const RATE_CATEGORIES = ['A', 'B', 'C', 'D'];

export const RATE_VAT_NOTICE = 'All rates are quoted per hour of machine usage and exclude VAT (excl. VAT).';

