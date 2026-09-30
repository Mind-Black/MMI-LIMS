import React, { useState } from 'react';
import Icon from './Icon';
import { supabase } from '../supabaseClient';
import { useToast } from '../context/useToast';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { getVilniusNow } from '../utils/bookingUtils';

const ApplyTrainingModal = ({ isOpen, onClose, tool, user, profile, onSuccess }) => {
    const [preferredDate, setPreferredDate] = useState('');
    const [description, setDescription] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const { showToast } = useToast();
    const dialogRef = useDialogFocus(isOpen, onClose);

    if (!isOpen || !tool) return null;

    const todayStr = getVilniusNow().dateStr;
    const responsible = tool.primary_responsible || null;

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!preferredDate) {
            showToast('Please select your preferred training date.', 'error');
            return;
        }
        if (!description.trim()) {
            showToast('Please provide a short description or motivation.', 'error');
            return;
        }

        setIsSubmitting(true);
        try {
            const userName = `${profile?.first_name || ''} ${profile?.last_name || ''}`.trim() || user?.email || 'Unknown User';
            const userEmail = profile?.email || user?.email || '';

            const { data, error } = await supabase
                .from('training_requests')
                .insert({
                    tool_id: tool.id,
                    tool_name: tool.name,
                    user_id: user.id,
                    user_name: userName,
                    user_email: userEmail,
                    description: description.trim(),
                    preferred_date: preferredDate,
                    status: 'pending'
                })
                .select()
                .single();

            if (error) throw error;

            showToast(`Training request for "${tool.name}" submitted successfully!`, 'success');
            onSuccess?.(data);
            onClose();
        } catch (err) {
            console.error('Error submitting training request:', err);
            const msg = err.message?.includes('training_requests') || err.message?.includes('does not exist')
                ? 'Training request system is pending database migration. Please notify the administrator.'
                : ('Failed to submit application: ' + (err.message || 'Unknown error'));
            showToast(msg, 'error');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="apply-training-title"
                tabIndex={-1}
                className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-lg w-full p-6 space-y-4 border dark:border-gray-700 transition-colors"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex justify-between items-start border-b dark:border-gray-700 pb-3">
                    <div>
                        <h3 id="apply-training-title" className="text-lg font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                            <Icon className="fas fa-graduation-cap text-blue-600 dark:text-blue-400" />
                            Apply for Equipment Training
                        </h3>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                            {tool.name} &bull; {tool.category} &bull; {tool.location || 'Lab'}
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close training application dialog"
                        className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1"
                    >
                        <Icon className="fas fa-times text-lg" />
                    </button>
                </div>

                {/* Tool Responsible Contact Banner */}
                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/40 rounded-lg p-3 text-xs text-blue-800 dark:text-blue-200 space-y-1">
                    <div className="font-semibold flex items-center gap-1.5">
                        <Icon className="fas fa-user-shield text-blue-600 dark:text-blue-400" />
                        Tool Responsible: {responsible ? `${responsible.first_name || ''} ${responsible.last_name || ''}`.trim() : 'Lab Administrator'}
                    </div>
                    {responsible?.job_title && (
                        <p className="text-blue-700 dark:text-blue-300">{responsible.job_title}</p>
                    )}
                    <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1 text-blue-600 dark:text-blue-400">
                        {responsible?.email && (
                            <span className="flex items-center gap-1">
                                <Icon className="fas fa-envelope text-xs" />
                                <a href={`mailto:${responsible.email}`} className="underline hover:text-blue-800 dark:hover:text-blue-200">{responsible.email}</a>
                            </span>
                        )}
                        {responsible?.phone && (
                            <span className="flex items-center gap-1">
                                <Icon className="fas fa-phone text-xs" />
                                <span>{responsible.phone}</span>
                            </span>
                        )}
                    </div>
                </div>

                {/* Application Form */}
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label htmlFor="preferred-training-date" className="block text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase mb-1">
                            Preferred Training Date *
                        </label>
                        <input
                            id="preferred-training-date"
                            type="date"
                            required
                            min={todayStr}
                            value={preferredDate}
                            onChange={(e) => setPreferredDate(e.target.value)}
                            className="input-field text-sm"
                        />
                        <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
                            Training schedule will be finalized with the Tool Responsible.
                        </p>
                    </div>

                    <div>
                        <label htmlFor="training-description" className="block text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase mb-1">
                            Short Description & Purpose *
                        </label>
                        <textarea
                            id="training-description"
                            required
                            rows="4"
                            placeholder="Briefly state your project, intended samples, and any prior experience with this or similar instruments..."
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            className="input-field text-sm leading-relaxed"
                        ></textarea>
                    </div>

                    <div className="bg-gray-50 dark:bg-gray-750 p-2.5 rounded text-xs text-gray-600 dark:text-gray-300 flex items-center gap-2">
                        <Icon className="fas fa-info-circle text-blue-500" />
                        <span>Upon approval, your account will be granted <strong>Level I (In Training)</strong> access.</span>
                    </div>

                    <div className="flex justify-end gap-2 pt-2 border-t dark:border-gray-700">
                        <button
                            type="button"
                            onClick={onClose}
                            className="btn btn-secondary btn-sm"
                            disabled={isSubmitting}
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={isSubmitting}
                            className="btn btn-primary btn-sm flex items-center gap-1.5"
                        >
                            {isSubmitting ? <Icon className="fas fa-spinner fa-spin" /> : <Icon className="fas fa-paper-plane" />}
                            Submit Application
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default ApplyTrainingModal;
