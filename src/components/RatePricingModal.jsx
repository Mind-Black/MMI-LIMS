import React from 'react';
import Icon from './Icon';
import RateCategoryBadge, { RATE_TIER_DETAILS } from './RateCategoryBadge';
import { useDialogFocus } from '../hooks/useDialogFocus';

/**
 * RatePricingModal
 * Displays institutional equipment rate categories (A-D) and hourly pricing
 * across the three official access modes:
 * - External Users (Išorės vartotojams)
 * - KTU Other Departments (Kitiems KTU padaliniams)
 * - MMI Institute Department (MMI padaliniui)
 */
export const RatePricingModal = ({ isOpen, onClose }) => {
    const dialogRef = useDialogFocus(isOpen, onClose);

    if (!isOpen) return null;

    const tiers = [
        {
            category: 'A',
            title: 'Basic & General Equipment',
            badgeClass: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
            external: '7.44 €/h',
            ktu: '4.00 €/h',
            dept: '0.02 – 0.20 €/h',
            equipmentSummary: 'Optical tables, spin coaters, drying ovens, mixers, light sources, basic characterization & sample preparation tools.',
            examples: [
                'Laser power meter - Ophir Nova II',
                'Laser ellipsometer - Gaertner L115',
                'Thin layer deposition spin coater',
                'Spectroscopic detector - Kymera 193i',
                'Pencil & Sclerometer hardness testers'
            ]
        },
        {
            category: 'B',
            title: 'Standard Analysis & Deposition',
            badgeClass: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 border-blue-200 dark:border-blue-800',
            external: '12.50 – 19.01 €/h',
            ktu: '7.50 – 10.50 €/h',
            dept: '0.05 €/h',
            equipmentSummary: 'Surface profilometry, optical spectroscopy, thermal evaporation, magnetron sputtering, and mass spectrometry.',
            examples: [
                'Stylus surface profilometer - Bruker Dektak Pro',
                'Raman spectrometer - Renishaw inVia',
                'Magnetron sputtering tool - LH A700',
                'Thermal evaporator - CUBIVAP',
                'Atmospheric gas mass spectrometer - OmniStar'
            ]
        },
        {
            category: 'C',
            title: 'Advanced Analytical & High-Energy Systems',
            badgeClass: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border-amber-200 dark:border-amber-800',
            external: '35.12 €/h',
            ktu: '21.00 €/h',
            dept: '0.11 €/h',
            equipmentSummary: 'High-resolution electron microscopy, femtosecond laser micromachining, surface analysis, and reactive plasma etching.',
            examples: [
                'Scanning electron microscope - FEI Quanta 200 FEG',
                'Laser microfabrication system - FemtoLAB',
                'X-Ray photoelectron spectrometer - ESCALAB 250Xi',
                'Reactive ion etching / plasma deposition - PK-2430'
            ]
        },
        {
            category: 'D',
            title: 'Premium Nano-Fabrication & Deep Etch',
            badgeClass: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300 border-purple-200 dark:border-purple-800',
            external: '48.76 €/h',
            ktu: '28.50 €/h',
            dept: '0.14 €/h',
            equipmentSummary: 'High-end electron beam lithography, high-density inductively coupled plasma etching, and specialized ion-beam synthesizers.',
            examples: [
                'Electron beam lithography (EBL) - Raith e-Line Plus',
                'ICP-RIE etching system - PlasmaTherm Apex SLR',
                'High-vacuum ion-beam synthesis platform'
            ]
        }
    ];

    return (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-3 sm:p-4 backdrop-blur-xs animate-fadeIn">
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="pricing-modal-title"
                tabIndex={-1}
                className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-4xl w-full p-5 sm:p-6 border dark:border-gray-700 max-h-[92vh] overflow-y-auto space-y-5"
            >
                {/* Header */}
                <div className="flex justify-between items-start border-b dark:border-gray-700 pb-3">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 flex items-center justify-center text-xl shrink-0">
                            <Icon className="fas fa-tags" />
                        </div>
                        <div>
                            <h3 id="pricing-modal-title" className="text-lg sm:text-xl font-bold text-gray-900 dark:text-gray-100">
                                Equipment Rate Categories & Access Modes
                            </h3>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                                Kaunas University of Technology · Institute of Materials Science (KTU MMI)
                            </p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition cursor-pointer"
                        aria-label="Close rate guide"
                    >
                        <Icon className="fas fa-times text-lg" />
                    </button>
                </div>

                {/* Explanation of Access Modes */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="p-3.5 rounded-lg bg-emerald-50/70 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800/50">
                        <div className="flex items-center gap-2 mb-1">
                            <Icon className="fas fa-building text-emerald-600 dark:text-emerald-400 text-sm" />
                            <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-900 dark:text-emerald-300">
                                External Users
                            </h4>
                        </div>
                        <p className="text-xs text-emerald-800 dark:text-emerald-300/90 leading-relaxed">
                            Commercial companies, private industrial partners, and external research/academic organizations (<em>Išorės vartotojams</em>).
                        </p>
                    </div>

                    <div className="p-3.5 rounded-lg bg-blue-50/70 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800/50">
                        <div className="flex items-center gap-2 mb-1">
                            <Icon className="fas fa-university text-blue-600 dark:text-blue-400 text-sm" />
                            <h4 className="text-xs font-bold uppercase tracking-wider text-blue-900 dark:text-blue-300">
                                KTU Departments
                            </h4>
                        </div>
                        <p className="text-xs text-blue-800 dark:text-blue-300/90 leading-relaxed">
                            Researchers, academic faculty, PhD candidates, and students from other KTU departments & institutes (<em>Kitiems KTU padaliniams</em>).
                        </p>
                    </div>

                    <div className="p-3.5 rounded-lg bg-purple-50/70 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-800/50">
                        <div className="flex items-center gap-2 mb-1">
                            <Icon className="fas fa-microscope text-purple-600 dark:text-purple-400 text-sm" />
                            <h4 className="text-xs font-bold uppercase tracking-wider text-purple-900 dark:text-purple-300">
                                MMI Institute
                            </h4>
                        </div>
                        <p className="text-xs text-purple-800 dark:text-purple-300/90 leading-relaxed">
                            Direct MMI research personnel and institute laboratory projects, billing nominal maintenance & consumables overhead (<em>MMI padaliniui</em>).
                        </p>
                    </div>
                </div>

                {/* Primary Pricing Matrix Table */}
                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <h4 className="text-sm font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2">
                            <Icon className="fas fa-table text-blue-600 dark:text-blue-400" />
                            Hourly Service Rates Matrix
                        </h4>
                        <span className="text-[11px] text-gray-500 dark:text-gray-400">
                            Rates quoted in EUR per hour of autonomous machine usage (€/h)
                        </span>
                    </div>

                    <div className="overflow-x-auto border dark:border-gray-700 rounded-lg">
                        <table className="w-full text-left border-collapse text-xs sm:text-sm">
                            <thead className="bg-gray-50 dark:bg-gray-900 border-b dark:border-gray-700 text-gray-700 dark:text-gray-300">
                                <tr>
                                    <th className="p-3 font-semibold">Tier</th>
                                    <th className="p-3 font-semibold">Scope & Description</th>
                                    <th className="p-3 font-semibold text-center whitespace-nowrap bg-emerald-50/50 dark:bg-emerald-950/10">
                                        External Rate
                                    </th>
                                    <th className="p-3 font-semibold text-center whitespace-nowrap bg-blue-50/50 dark:bg-blue-950/10">
                                        KTU Depts
                                    </th>
                                    <th className="p-3 font-semibold text-center whitespace-nowrap bg-purple-50/50 dark:bg-purple-950/10">
                                        MMI Dept
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y dark:divide-gray-700">
                                {tiers.map(t => (
                                    <tr key={t.category} className="hover:bg-gray-50/50 dark:hover:bg-gray-700/30 transition-colors">
                                        <td className="p-3 align-top">
                                            <div className="flex items-center gap-2">
                                                <RateCategoryBadge rate={t.category} />
                                                <span className="font-bold text-gray-900 dark:text-gray-100 hidden sm:inline">
                                                    Tier {t.category}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="p-3 align-top">
                                            <div className="font-semibold text-gray-800 dark:text-gray-200">
                                                {t.title}
                                            </div>
                                            <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 leading-relaxed">
                                                {t.equipmentSummary}
                                            </div>
                                        </td>
                                        <td className="p-3 align-top text-center font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-50/20 dark:bg-emerald-950/5 whitespace-nowrap">
                                            {t.external}
                                        </td>
                                        <td className="p-3 align-top text-center font-bold text-blue-700 dark:text-blue-400 bg-blue-50/20 dark:bg-blue-950/5 whitespace-nowrap">
                                            {t.ktu}
                                        </td>
                                        <td className="p-3 align-top text-center font-bold text-purple-700 dark:text-purple-400 bg-purple-50/20 dark:bg-purple-950/5 whitespace-nowrap">
                                            {t.dept}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Equipment Examples by Tier */}
                <div className="space-y-2">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                        Representative Equipment in Each Tier
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
                        {tiers.map(t => (
                            <div key={`ex-${t.category}`} className="p-3 rounded-lg border dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/50 space-y-2">
                                <div className="flex items-center justify-between">
                                    <span className="font-bold text-gray-800 dark:text-gray-200">Tier {t.category}</span>
                                    <RateCategoryBadge rate={t.category} size="xs" />
                                </div>
                                <ul className="space-y-1 text-gray-600 dark:text-gray-400 text-[11px] list-disc list-inside">
                                    {t.examples.map((ex, i) => (
                                        <li key={i} className="truncate" title={ex}>
                                            {ex}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Operational Policy Notes */}
                <div className="p-4 rounded-lg bg-gray-50 dark:bg-gray-900/60 border dark:border-gray-700 text-xs text-gray-600 dark:text-gray-400 space-y-2">
                    <h5 className="font-bold text-gray-800 dark:text-gray-200 flex items-center gap-1.5">
                        <Icon className="fas fa-info-circle text-blue-500" />
                        Usage, Licensing & Billing Guidelines
                    </h5>
                    <ul className="list-disc list-inside space-y-1 leading-relaxed">
                        <li>
                            <strong>Autonomous Tool Usage:</strong> Rates apply to scheduled equipment runtime. Operators must hold valid Level II (Supervised) or Level III (Independent) license authorization for licensed equipment.
                        </li>
                        <li>
                            <strong>Operator Assistance:</strong> If hands-on operator assistance, engineering service, or specialized sample preparation is required, staff specialist consulting hours are added based on institutional service contracts.
                        </li>
                        <li>
                            <strong>Project Accounting:</strong> KTU and MMI reservations must be linked to an approved internal research grant or institutional project number during reservation confirmation.
                        </li>
                    </ul>
                </div>

                {/* Footer */}
                <div className="flex justify-end pt-2 border-t dark:border-gray-700">
                    <button
                        type="button"
                        onClick={onClose}
                        className="btn btn-primary text-sm px-5"
                    >
                        Got it
                    </button>
                </div>
            </div>
        </div>
    );
};

export default RatePricingModal;
