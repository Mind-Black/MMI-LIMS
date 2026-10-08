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
        <div role={isError ? 'alert' : 'status'} aria-live={isError ? 'assertive' : 'polite'} className="fixed bottom-6 right-6 bg-gray-800 text-white px-6 py-4 rounded shadow-lg z-50 flex items-center gap-3 toast-enter">
            <Icon className={`fas ${isError ? 'fa-exclamation-circle text-red-400' : 'fa-check-circle text-green-400'} text-xl`} />
            <div>
                <h4 className="font-bold text-sm capitalize">{type}</h4>
                <p className="text-xs text-gray-300">{message}</p>
            </div>
            <button onClick={onClose} aria-label="Dismiss notification" className="ml-4 text-gray-400 hover:text-white">
                <Icon className="fas fa-times" />
            </button>
        </div>
    );
};

export default Toast;
