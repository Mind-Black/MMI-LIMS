import React from 'react';
import Icon from './Icon';
import { useDialogFocus } from '../hooks/useDialogFocus';

const ConfirmModal = ({ isOpen, title, message, onConfirm, onCancel, showCheckbox, checkboxLabel, onCheckboxChange, isCheckboxChecked, isLoading }) => {
    const dialogRef = useDialogFocus(isOpen, isLoading ? undefined : onCancel);
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-sm p-4 modal-backdrop">
            <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-message" tabIndex={-1} className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-sm max-h-[90dvh] overflow-y-auto modal-scroll p-5 sm:p-6 transform transition-all scale-100 border dark:border-gray-700">
                <div className="text-center">
                    <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-red-100 dark:bg-red-900/30 mb-4">
                        <Icon className="fas fa-exclamation-triangle text-red-600 dark:text-red-400 text-xl" />
                    </div>
                    <h3 id="confirm-title" className="text-lg font-bold text-gray-900 dark:text-white">{title}</h3>
                    <p id="confirm-message" className="text-sm text-gray-500 dark:text-gray-400 mt-2">{message}</p>

                    {showCheckbox && (
                        <label htmlFor="confirm-checkbox" className="mt-4 inline-flex items-center justify-center gap-2.5 min-h-[44px] px-2 text-left text-sm text-gray-700 dark:text-gray-300 cursor-pointer select-none">
                            <input
                                type="checkbox"
                                id="confirm-checkbox"
                                checked={isCheckboxChecked}
                                onChange={(e) => onCheckboxChange(e.target.checked)}
                                className="w-5 h-5 shrink-0 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                            />
                            <span>{checkboxLabel}</span>
                        </label>
                    )}
                </div>
                <div className="mt-6 flex gap-3">
                    <button onClick={onCancel} disabled={isLoading} className="btn btn-secondary w-full">
                        Cancel
                    </button>
                    <button onClick={onConfirm} disabled={isLoading} className="btn btn-danger w-full flex justify-center items-center gap-2">
                        {isLoading && <Icon className="fas fa-spinner fa-spin" />}
                        Confirm
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ConfirmModal;
