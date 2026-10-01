import React from 'react';

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

/**
 * RateCategoryBadge
 * Renders a standardized, color-coded badge displaying tool rate category (A, B, C, D).
 * A: Emerald / Green (Cheapest)
 * B: Blue / Sky (Moderate)
 * C: Amber / Orange (High)
 * D: Purple / Rose (Premium)
 */
export const RateCategoryBadge = ({ rate, className = "", size = "sm" }) => {
    const r = (rate || 'A').toUpperCase().trim();
    const details = RATE_TIER_DETAILS[r] || RATE_TIER_DETAILS.A;

    let colorClasses = 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800';

    if (r === 'B') {
        colorClasses = 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 border-blue-200 dark:border-blue-800';
    } else if (r === 'C') {
        colorClasses = 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border-amber-200 dark:border-amber-800';
    } else if (r === 'D') {
        colorClasses = 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300 border-purple-200 dark:border-purple-800';
    }

    const sizeClass = size === 'xs' ? 'text-[10px] px-1.5 py-0.2' : 'text-xs px-2 py-0.5';

    return (
        <span
            className={`inline-flex items-center justify-center font-bold rounded border shadow-xs select-none ${sizeClass} ${colorClasses} ${className}`}
            title={`Rate ${r}: External ${details.external} | KTU ${details.ktu} | Dept ${details.dept}`}
        >
            {r}
        </span>
    );
};

export default RateCategoryBadge;
