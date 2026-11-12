import React, { useState } from 'react';
import Icon from './Icon';
import { LAB_TIMEZONE } from '../utils/bookingUtils';
import { useDialogFocus } from '../hooks/useDialogFocus';

/**
 * TutorialModal
 * Quick-start, step-by-step guide to the main MMI-LIMS workflows.
 * Opened from the sidebar "Tutorial" entry, and automatically once per browser.
 */
const buildSteps = ({ isAdmin, onNavigate, onOpenPricing, onOpenCalendarSync }) => {
    const steps = [
        {
            id: 'welcome',
            icon: 'fa-graduation-cap',
            title: 'Welcome to MMI-LIMS',
            body: 'MMI-LIMS is where you find laboratory equipment, check its availability, reserve time on it and track your training licences. This short tour shows you the essentials.',
            bullets: [
                `All dates and times are shown in the lab timezone (${LAB_TIMEZONE}).`,
                'Use Next and Back to move through the steps, or Skip to close the tour.',
            ],
        },
        {
            id: 'dashboard',
            icon: 'fa-calendar-alt',
            title: 'Your dashboard',
            body: 'My Dashboard is your home page. It gives you a quick overview of your activity in the lab.',
            bullets: [
                'Next Reservation: your next booking at a glance.',
                'Weekly Reservation Calendar: everything you have booked this week.',
                'Quick Book (Recent Tools): book again on equipment you used recently.',
                'Upcoming Bookings and Past Reservations: your booking history.',
            ],
            action: { label: 'Go to My Dashboard', run: () => onNavigate('dashboard') },
        },
        {
            id: 'equipment',
            icon: 'fa-microscope',
            title: 'Equipment and licence levels',
            body: 'The Equipment List shows every tool with its status, location, rate tier and your access level. Some tools require a licence before you can book them:',
            bullets: [
                'Level I (In Training): you are being trained and cannot book yet.',
                'Level II (Supervised): you can book, but the tool responsible must confirm each reservation.',
                'Level III (Licensed): you can book independently.',
            ],
            action: { label: 'Go to Equipment List', run: () => onNavigate('tools') },
        },
        {
            id: 'booking',
            icon: 'fa-plus',
            title: 'Booking a tool',
            body: 'Click Book next to a tool in the Equipment List (or in Quick Book) to open the booking window.',
            bullets: [
                'Pick free slots in the week calendar, or enter a Date, Start and End time.',
                'Choose the project the time should be billed to.',
                'Click Check & Apply Time, then Confirm to create the reservation.',
                'Level II reservations appear as pending until they are approved.',
            ],
        },
        {
            id: 'training',
            icon: 'fa-user-graduate',
            title: 'Applying for training',
            body: 'If a tool needs a licence you do not have yet, click Apply next to it in the Equipment List.',
            bullets: [
                'Describe your experience and suggest a preferred training date.',
                'Once the tool responsible approves your application, you receive Level I (In Training).',
                'After training, your level is raised so you can book the tool.',
            ],
        },
        {
            id: 'manage',
            icon: 'fa-edit',
            title: 'Managing your bookings',
            body: 'Open a booking from Upcoming Bookings on your dashboard to change or cancel it.',
            bullets: [
                'Change the time or project, or cancel the reservation.',
                'Bookings that are in progress or already finished are locked.',
                'Cancelling frees the slot for other users right away.',
            ],
            action: { label: 'Go to My Dashboard', run: () => onNavigate('dashboard') },
        },
        {
            id: 'extras',
            icon: 'fa-tags',
            title: 'Rates and calendar sync',
            body: 'Two more tools help you plan your work:',
            bullets: [
                'Rates & Pricing (in the sidebar) lists the hourly rates for each equipment tier and access mode.',
                'Sync External Calendar gives you a private feed link, so your reservations show up in Outlook, Google Calendar or Apple Calendar.',
            ],
            actions: [
                { label: 'Open Rates & Pricing', run: onOpenPricing },
                { label: 'Sync my calendar', run: onOpenCalendarSync },
            ],
        },
    ];

    if (isAdmin) {
        steps.push({
            id: 'admin',
            icon: 'fa-users-cog',
            title: 'Administration',
            body: 'As an administrator you also have the Administration section in the sidebar:',
            bullets: [
                'All Bookings: search, filter and export every reservation in the facility.',
                'User Management: approve accounts, set access levels and assign licences.',
                'Infrastructure: add, edit and retire equipment.',
                'Training applications and Level II reservations waiting for you are flagged with a bell in the Equipment List.',
            ],
            action: { label: 'Go to All Bookings', run: () => onNavigate('all_bookings') },
        });
    }

    steps.push({
        id: 'done',
        icon: 'fa-check-circle',
        title: "You're all set",
        body: 'That is everything you need to get started. You can reopen this tour at any time from Tutorial in the sidebar.',
        bullets: [],
    });

    return steps;
};

const TutorialModal = ({ isOpen, onClose, isAdmin = false, onNavigate, onOpenPricing, onOpenCalendarSync }) => {
    const [stepIndex, setStepIndex] = useState(0);
    const dialogRef = useDialogFocus(isOpen, onClose);

    if (!isOpen) return null;

    const steps = buildSteps({ isAdmin, onNavigate, onOpenPricing, onOpenCalendarSync });
    const index = Math.min(stepIndex, steps.length - 1);
    const step = steps[index];
    const isFirst = index === 0;
    const isLast = index === steps.length - 1;
    const stepActions = step.actions || (step.action ? [step.action] : []);

    const runAction = (action) => {
        onClose();
        action.run?.();
    };

    return (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-3 sm:p-4 backdrop-blur-xs animate-fadeIn">
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="tutorial-modal-title"
                aria-describedby="tutorial-step-body"
                tabIndex={-1}
                className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-xl w-full border dark:border-gray-700 max-h-[92vh] overflow-y-auto flex flex-col"
            >
                {/* Header */}
                <div className="flex justify-between items-center gap-3 border-b dark:border-gray-700 px-5 sm:px-6 py-4">
                    <div className="flex items-center gap-3 min-w-0">
                        <div className="w-10 h-10 rounded-lg bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 flex items-center justify-center text-xl shrink-0">
                            <Icon className="fas fa-graduation-cap" />
                        </div>
                        <div className="min-w-0">
                            <h2 id="tutorial-modal-title" className="text-lg font-bold text-gray-900 dark:text-gray-100">
                                Quick-start tutorial
                            </h2>
                            <p className="text-xs text-gray-500 dark:text-gray-400" aria-live="polite">
                                Step {index + 1} of {steps.length}
                            </p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition cursor-pointer"
                        aria-label="Close tutorial"
                    >
                        <Icon className="fas fa-times text-lg" />
                    </button>
                </div>

                {/* Step content */}
                <div className="px-5 sm:px-6 py-5 space-y-4 min-h-[260px]">
                    <div className="flex items-start gap-3">
                        <div className="w-12 h-12 rounded-full bg-blue-600 text-white flex items-center justify-center text-xl shrink-0 shadow-sm">
                            <Icon className={`fas ${step.icon}`} />
                        </div>
                        <div className="min-w-0">
                            <h3 className="text-base sm:text-lg font-bold text-gray-900 dark:text-gray-100">{step.title}</h3>
                            <p id="tutorial-step-body" className="text-sm text-gray-600 dark:text-gray-300 mt-1 leading-relaxed">
                                {step.body}
                            </p>
                        </div>
                    </div>

                    {step.bullets.length > 0 && (
                        <ul className="space-y-2 text-sm text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-900/50 border dark:border-gray-700 rounded-lg p-4">
                            {step.bullets.map(text => (
                                <li key={text} className="flex gap-2 leading-relaxed">
                                    <Icon className="fas fa-check-circle text-blue-600 dark:text-blue-400 shrink-0 mt-1 text-xs" />
                                    <span>{text}</span>
                                </li>
                            ))}
                        </ul>
                    )}

                    {stepActions.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                            {stepActions.map(action => (
                                <button
                                    key={action.label}
                                    type="button"
                                    onClick={() => runAction(action)}
                                    className="btn btn-secondary btn-sm flex items-center gap-1.5 text-blue-600 dark:text-blue-400"
                                >
                                    <span>{action.label}</span>
                                    <Icon className="fas fa-arrow-right text-xs" />
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 border-t dark:border-gray-700 px-5 sm:px-6 py-4">
                    <div className="flex items-center justify-center gap-1.5" role="group" aria-label="Tutorial steps">
                        {steps.map((s, i) => (
                            <button
                                key={s.id}
                                type="button"
                                onClick={() => setStepIndex(i)}
                                aria-label={`Step ${i + 1}: ${s.title}`}
                                aria-current={i === index ? 'step' : undefined}
                                className={`h-2.5 rounded-full transition-all cursor-pointer ${i === index ? 'w-6 bg-blue-600' : 'w-2.5 bg-gray-300 dark:bg-gray-600 hover:bg-gray-400 dark:hover:bg-gray-500'}`}
                            />
                        ))}
                    </div>
                    <div className="flex items-center justify-end gap-2">
                        {!isLast && (
                            <button type="button" onClick={onClose} className="btn btn-ghost btn-sm">
                                Skip
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={() => setStepIndex(i => Math.max(0, i - 1))}
                            disabled={isFirst}
                            className="btn btn-secondary btn-sm flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <Icon className="fas fa-arrow-left text-xs" />
                            Back
                        </button>
                        {isLast ? (
                            <button type="button" onClick={onClose} className="btn btn-primary btn-sm">
                                Finish
                            </button>
                        ) : (
                            <button
                                type="button"
                                onClick={() => setStepIndex(i => Math.min(steps.length - 1, i + 1))}
                                className="btn btn-primary btn-sm flex items-center gap-1"
                            >
                                Next
                                <Icon className="fas fa-arrow-right text-xs" />
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default TutorialModal;
