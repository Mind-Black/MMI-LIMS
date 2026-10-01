/**
 * Rate category definitions and institutional pricing details for MMI equipment
 */
export const RATE_TIER_DETAILS = {
    A: {
        label: 'Category A (Basic & General)',
        external: '7.44 €/h',
        ktu: '4.00 €/h',
        dept: '0.02 – 0.20 €/h',
        description: 'General equipment, sample prep, optical tables & basic characterization'
    },
    B: {
        label: 'Category B (Standard)',
        external: '12.50 – 19.01 €/h',
        ktu: '7.50 – 10.50 €/h',
        dept: '0.05 €/h',
        description: 'Standard analysis: Raman, profilometers, sputtering, thermal evaporation'
    },
    C: {
        label: 'Category C (Advanced)',
        external: '35.12 €/h',
        ktu: '21.00 €/h',
        dept: '0.11 €/h',
        description: 'Advanced systems: SEM, femtosecond laser micromachining, XPS, RIE/PECVD'
    },
    D: {
        label: 'Category D (Premium)',
        external: '48.76 €/h',
        ktu: '28.50 €/h',
        dept: '0.14 €/h',
        description: 'Premium nano-fabrication: Electron beam lithography (EBL), ICP-RIE'
    }
};

export const RATE_CATEGORIES = ['A', 'B', 'C', 'D'];
