import React from 'react';

const StatusBadge = ({ status }) => {
    const config = {
        up: { color: 'bg-green-500', text: 'Available' },
        down: { color: 'bg-red-500', text: 'Down' },
        service: { color: 'bg-yellow-500', text: 'Service' },
    };
    const current = config[status] || config.up;
    return (
        <div className="flex items-center gap-2">
            <span className={`status-dot ${current.color}`}></span>
            <span className="text-sm capitalize text-gray-700">{status}</span>
        </div>
    );
};

export default StatusBadge;
