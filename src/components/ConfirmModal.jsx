import React from 'react';

const ConfirmModal = ({ isOpen, title, message, onConfirm, onCancel, showCheckbox, checkboxLabel, onCheckboxChange, isCheckboxChecked }) => {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-sm">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-sm p-6 transform transition-all scale-100 border dark:border-gray-700">
                <div className="text-center">
                    <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-red-100 dark:bg-red-900/30 mb-4">
                        <i className="fas fa-exclamation-triangle text-red-600 dark:text-red-400 text-xl"></i>
                    </div>
                    <h3 className="text-lg font-bold text-gray-900 dark:text-white">{title}</h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">{message}</p>

                    {showCheckbox && (
                        <div className="mt-4 flex items-center justify-center gap-2 text-left">
                            <input
                                type="checkbox"
                                id="confirm-checkbox"
                                checked={isCheckboxChecked}
                                onChange={(e) => onCheckboxChange(e.target.checked)}
                                className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                            />
                            <label htmlFor="confirm-checkbox" className="text-sm text-gray-700 dark:text-gray-300 cursor-pointer select-none">
                                {checkboxLabel}
                            </label>
                        </div>
                    )}
                </div>
                <div className="mt-6 flex gap-3">
                    <button onClick={onCancel} className="w-full inline-flex justify-center rounded-md border border-gray-300 dark:border-gray-600 shadow-sm px-4 py-2 bg-white dark:bg-gray-700 text-base font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600 sm:text-sm transition-colors">
                        Cancel
                    </button>
                    <button onClick={onConfirm} className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-red-600 hover:bg-red-700 text-base font-medium text-white sm:text-sm transition-colors">
                        Confirm
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ConfirmModal;
