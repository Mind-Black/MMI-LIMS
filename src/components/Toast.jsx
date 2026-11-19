import React, { useEffect } from 'react';
import Icon from './Icon';

const Toast = ({ message, type = 'success', onClose }) => {
    useEffect(() => {
        if (type === 'error') return undefined;
        const timer = setTimeout(onClose, 5000);
        return () => clearTimeout(timer);
    }, [onClose, type]);

    const isError = type === 'error';

    return (
        <div role={isError ? 'alert' : 'status'} aria-live={isError ? 'assertive' : 'polite'} className="fixed left-3 right-3 sm:left-auto sm:right-6 bottom-[calc(5rem+env(safe-area-inset-bottom))] lg:bottom-6 sm:max-w-md bg-gray-800 text-white px-4 py-3 sm:px-5 sm:py-4 rounded-xl shadow-lg z-[70] flex items-center gap-3 toast-enter">
            <Icon className={`fas ${isError ? 'fa-exclamation-circle text-red-400' : 'fa-check-circle text-green-400'} text-xl`} />
            <div className="min-w-0 flex-1">
                <h4 className="font-bold text-sm capitalize">{type}</h4>
                <p className="text-xs text-gray-300 break-words">{message}</p>
            </div>
            <button onClick={onClose} aria-label="Dismiss notification" className="btn-icon -mr-2 text-gray-300 hover:text-white hover:bg-white/10 shrink-0">
                <Icon className="fas fa-times" />
            </button>
        </div>
    );
};

export default Toast;
