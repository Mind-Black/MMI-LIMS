import React, { useEffect } from 'react';

const Toast = ({ message, type = 'success', onClose }) => {
    useEffect(() => {
        const timer = setTimeout(onClose, 3000);
        return () => clearTimeout(timer);
    }, [onClose]);

    const isError = type === 'error';

    return (
        <div className="fixed bottom-6 right-6 bg-gray-800 text-white px-6 py-4 rounded shadow-lg z-50 flex items-center gap-3 toast-enter">
            <i className={`fas ${isError ? 'fa-exclamation-circle text-red-400' : 'fa-check-circle text-green-400'} text-xl`}></i>
            <div>
                <h4 className="font-bold text-sm capitalize">{type}</h4>
                <p className="text-xs text-gray-300">{message}</p>
            </div>
            <button onClick={onClose} className="ml-4 text-gray-400 hover:text-white">
                <i className="fas fa-times"></i>
            </button>
        </div>
    );
};

export default Toast;
