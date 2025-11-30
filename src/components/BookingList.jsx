import React, { useMemo } from 'react';

import { groupBookings } from '../utils/bookingUtils';

const BookingList = ({ bookings, onCancel, onUpdate, allBookings, isAdminView = false }) => {

    const groupedBookings = useMemo(() => groupBookings(bookings), [bookings]);

    return (
        <div className="space-y-6">

            {groupedBookings.length === 0 ? (
                <p className="text-gray-500">
                    {isAdminView ? 'No bookings found in the system.' : 'No bookings found.'}
                </p>
            ) : (
                <div className="space-y-2">
                    {groupedBookings.map(b => (
                        <div key={b.ids[0]} className="bg-white p-4 rounded shadow-sm border flex justify-between items-center">
                            <div>
                                <div className="font-bold text-blue-900">{b.tool_name}</div>
                                <div className="text-sm text-gray-600">
                                    {isAdminView && (
                                        <span className="font-semibold text-gray-800 mr-1">{b.user_name} |</span>
                                    )}
                                    {b.date} | {b.startTime} - {b.endTime}
                                </div>
                                {isAdminView && (
                                    <div className="text-xs text-gray-500">Project: {b.project}</div>
                                )}
                            </div>
                            <button
                                onClick={() => onCancel(b.ids)}
                                className={`text-sm font-semibold ${isAdminView
                                    ? 'text-red-500 hover:text-red-700 border border-red-200 px-3 py-1 rounded hover:bg-red-50'
                                    : 'text-red-500 hover:text-red-700'}`}
                            >
                                {isAdminView ? 'Delete Booking' : 'Cancel'}
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default BookingList;
