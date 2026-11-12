import React, { useState } from 'react';
import Icon from './Icon';
import { supabase } from '../supabaseClient';
import { useToast } from '../context/useToast';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { JOB_TITLES } from '../utils/userConstants';

const InviteUserModal = ({ isOpen, onClose, onInvited }) => {
    const [email, setEmail] = useState('');
    const [firstName, setFirstName] = useState('');
    const [lastName, setLastName] = useState('');
    const [jobTitle, setJobTitle] = useState('');
    const [projectInput, setProjectInput] = useState('');
    const [projects, setProjects] = useState([]);
    const [submitting, setSubmitting] = useState(false);

    const { showToast } = useToast();
    const dialogRef = useDialogFocus(isOpen, () => {
        if (!submitting) handleClose();
    });

    const resetForm = () => {
        setEmail('');
        setFirstName('');
        setLastName('');
        setJobTitle('');
        setProjectInput('');
        setProjects([]);
    };

    const handleClose = () => {
        resetForm();
        onClose();
    };

    const handleAddProject = () => {
        const clean = projectInput.trim();
        if (!clean) return;
        if (clean.length > 100) {
            showToast('Project name must be 100 characters or fewer.', 'error');
            return;
        }
        if (projects.includes(clean)) {
            showToast('Project already added.', 'error');
            return;
        }
        setProjects(prev => [...prev, clean]);
        setProjectInput('');
    };

    const handleRemoveProject = (proj) => {
        setProjects(prev => prev.filter(p => p !== proj));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        const cleanEmail = email.trim().toLowerCase();
        if (!cleanEmail) return;

        setSubmitting(true);
        try {
            const { data, error } = await supabase.functions.invoke('invite-user', {
                body: {
                    action: 'send',
                    email: cleanEmail,
                    first_name: firstName.trim() || null,
                    last_name: lastName.trim() || null,
                    job_title: jobTitle || null,
                    projects,
                },
            });

            if (error) {
                throw new Error(error.message || 'Failed to send invitation');
            }
            if (data?.error) {
                throw new Error(data.error);
            }

            showToast(`Invitation sent to ${cleanEmail}.`, 'success');
            if (onInvited && data?.invitation) {
                onInvited(data.invitation);
            }
            handleClose();
        } catch (err) {
            console.error('Error sending invitation:', err);
            showToast('Failed to send invitation: ' + err.message, 'error');
        } finally {
            setSubmitting(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4"
            role="presentation"
            onClick={(e) => {
                if (e.target === e.currentTarget && !submitting) handleClose();
            }}
        >
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="invite-user-modal-title"
                tabIndex={-1}
                className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-lg border border-gray-200 dark:border-gray-700 overflow-hidden animate-fade-in"
            >
                <div className="flex items-center justify-between px-6 py-4 border-b dark:border-gray-700">
                    <div>
                        <h4 id="invite-user-modal-title" className="text-lg font-bold text-gray-800 dark:text-gray-100">
                            Invite New User
                        </h4>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                            Invited users are automatically approved upon accepting their email invitation.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={handleClose}
                        disabled={submitting}
                        aria-label="Close invite modal"
                        className="btn btn-ghost btn-sm"
                    >
                        <Icon className="fas fa-times" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    <div>
                        <label htmlFor="invite-email" className="label">
                            Email Address <span className="text-red-500">*</span>
                        </label>
                        <input
                            id="invite-email"
                            type="email"
                            required
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                            className="input-field mt-1"
                            placeholder="colleague@ktu.lt"
                            autoComplete="email"
                        />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label htmlFor="invite-first-name" className="label">First Name (Optional)</label>
                            <input
                                id="invite-first-name"
                                type="text"
                                value={firstName}
                                onChange={e => setFirstName(e.target.value)}
                                className="input-field mt-1"
                                placeholder="John"
                            />
                        </div>
                        <div>
                            <label htmlFor="invite-last-name" className="label">Last Name (Optional)</label>
                            <input
                                id="invite-last-name"
                                type="text"
                                value={lastName}
                                onChange={e => setLastName(e.target.value)}
                                className="input-field mt-1"
                                placeholder="Doe"
                            />
                        </div>
                    </div>

                    <div>
                        <label htmlFor="invite-job-title" className="label">Job Title (Optional)</label>
                        <select
                            id="invite-job-title"
                            value={jobTitle}
                            onChange={e => setJobTitle(e.target.value)}
                            className="input-field mt-1 cursor-pointer"
                        >
                            <option value="">Select Job Title (optional)</option>
                            {JOB_TITLES.map(title => (
                                <option key={title} value={title}>{title}</option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label htmlFor="invite-project-input" className="label">Initial Projects (Optional)</label>
                        <div className="flex gap-2 mt-1">
                            <input
                                id="invite-project-input"
                                type="text"
                                value={projectInput}
                                onChange={e => setProjectInput(e.target.value)}
                                onKeyDown={e => {
                                    if (e.key === 'Enter') {
                                        e.preventDefault();
                                        handleAddProject();
                                    }
                                }}
                                className="input-field flex-1 text-sm"
                                placeholder="Add project name..."
                            />
                            <button
                                type="button"
                                onClick={handleAddProject}
                                className="btn btn-secondary btn-sm"
                            >
                                Add
                            </button>
                        </div>
                        {projects.length > 0 && (
                            <div className="flex flex-wrap gap-2 mt-2">
                                {projects.map(proj => (
                                    <span
                                        key={proj}
                                        className="bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 px-2 py-1 rounded text-xs flex items-center gap-1"
                                    >
                                        {proj}
                                        <button
                                            type="button"
                                            aria-label={`Remove project ${proj}`}
                                            onClick={() => handleRemoveProject(proj)}
                                            className="hover:text-red-500 ml-1"
                                        >
                                            <Icon className="fas fa-times text-[10px]" />
                                        </button>
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="flex justify-end gap-3 pt-4 border-t dark:border-gray-700">
                        <button
                            type="button"
                            onClick={handleClose}
                            disabled={submitting}
                            className="btn btn-secondary"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={submitting}
                            className="btn btn-primary flex items-center gap-2"
                        >
                            <Icon className={submitting ? 'fas fa-spinner fa-spin' : 'fas fa-paper-plane'} />
                            {submitting ? 'Sending...' : 'Send Invitation'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default InviteUserModal;
