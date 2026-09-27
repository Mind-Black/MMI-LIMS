import React from 'react';

const StatusBadge = ({ status }) => {
    const config = {
        up: { color: 'bg-green-500', text: 'Available' },
        down: { color: 'bg-red-500', text: 'Unavailable' },
        service: { color: 'bg-yellow-500', text: 'Under maintenance' },
    };
    const current = config[status] || { color: 'bg-gray-500', text: 'Status unknown' };
    return (
        <div className="flex items-center gap-2">
            <span aria-hidden="true" className={`status-dot ${current.color}`}></span>
            <span className="text-sm text-gray-700 dark:text-gray-200">{current.text}</span>
        </div>
    );
};

export default StatusBadge;
