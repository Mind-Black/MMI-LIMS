import React, { useState, useMemo } from 'react';
import { checkCollision, timeToMinutes, minutesToTime } from '../utils/bookingUtils';

const BookingEditPopup = ({ booking, existingBookings, onSave, onCancel }) => {
    const [date, setDate] = useState(booking.date);
    const [startTime, setStartTime] = useState(booking.startTime);
    const [endTime, setEndTime] = useState(booking.endTime);
    const [error, setError] = useState('');

    // Generate time options (08:00 - 20:00)
    const timeOptions = useMemo(() => {
        const options = [];
        for (let h = 8; h < 20; h++) {
            const hStr = h.toString().padStart(2, '0');
            options.push(`${hStr}:00`);
            options.push(`${hStr}:30`);
        }
        options.push('20:00'); // Allow end time to be 20:00
        return options;
    }, []);

    const handleSave = () => {
        setError('');

        // Basic Validation
        if (!date || !startTime || !endTime) {
            setError('All fields are required.');
            return;
        }

        const startMins = timeToMinutes(startTime);
        const endMins = timeToMinutes(endTime);

        if (startMins >= endMins) {
            setError('End time must be after start time.');
            return;
        }

        // Past Validation
        const now = new Date();
        const newStartDateTime = new Date(`${date}T${startTime}`);
        if (newStartDateTime < now) {
            setError('Cannot move booking to the past.');
            return;
        }

        // Active Booking Validation (cannot shorten end time to past)
        const originalStart = new Date(`${booking.date}T${booking.startTime}`);
        const originalEnd = new Date(`${booking.date}T${booking.endTime}`);
        const isActive = originalStart <= now && originalEnd > now;

        if (isActive) {
            const newEndDateTime = new Date(`${date}T${endTime}`);
            if (newEndDateTime <= now) {
                setError('Cannot shorten active booking to end in the past.');
                return;
            }
        }

        // Collision Validation
        const newBooking = {
            ...booking,
            date,
            startTime,
            endTime,
            tool_id: booking.tool_id
        };

        const hasCollision = checkCollision(newBooking, existingBookings, booking.ids);
        if (hasCollision) {
            setError('Booking overlaps with another booking.');
            return;
        }

        onSave(booking.ids, newBooking);
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60]">
            <div className="bg-white rounded-lg shadow-xl p-6 w-96">
                <h3 className="text-lg font-bold mb-4 text-gray-800">Edit Booking</h3>

                {error && (
                    <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-2 rounded mb-4 text-sm">
                        {error}
                    </div>
                )}

                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                        <input
                            type="date"
                            value={date}
                            onChange={(e) => setDate(e.target.value)}
                            className="w-full border rounded p-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Start Time</label>
                            <select
                                value={startTime}
                                onChange={(e) => setStartTime(e.target.value)}
                                className="w-full border rounded p-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            >
                                {timeOptions.slice(0, -1).map(t => (
                                    <option key={t} value={t}>{t}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">End Time</label>
                            <select
                                value={endTime}
                                onChange={(e) => setEndTime(e.target.value)}
                                className="w-full border rounded p-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            >
                                {timeOptions.map(t => (
                                    <option key={t} value={t} disabled={timeToMinutes(t) <= timeToMinutes(startTime)}>
                                        {t}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>
                </div>

                <div className="mt-6 flex justify-end gap-3">
                    <button
                        onClick={onCancel}
                        className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 font-medium"
                    >
                        Save Changes
                    </button>
                </div>
            </div>
        </div>
    );
};

export default BookingEditPopup;
