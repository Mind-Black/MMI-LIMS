import React, { useMemo } from 'react';

import { groupBookings } from '../utils/bookingUtils';

const BookingList = ({ bookings, onCancel, onUpdate, onEdit, allBookings, isAdminView = false, readOnly = false }) => {

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
                        <div key={b.ids[0]} className={`bg-white p-4 rounded shadow-sm border flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 sm:gap-0 ${readOnly ? 'opacity-75 bg-gray-50' : ''}`}>
                            <div>
                                <div className={`font-bold ${readOnly ? 'text-gray-700' : 'text-blue-900'}`}>{b.tool_name}</div>
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
                            <div className="flex gap-2">
                                <button
                                    onClick={() => onEdit(b)}
                                    disabled={readOnly}
                                    className={`text-sm font-semibold border px-3 py-1 rounded ${readOnly
                                        ? 'text-gray-400 border-gray-200 cursor-not-allowed'
                                        : 'text-blue-600 hover:text-blue-800 border-blue-200 hover:bg-blue-50'}`}
                                >
                                    Edit
                                </button>
                                <button
                                    onClick={() => onCancel(b.ids)}
                                    disabled={readOnly}
                                    className={`text-sm font-semibold border px-3 py-1 rounded ${readOnly
                                        ? 'text-gray-400 border-gray-200 cursor-not-allowed'
                                        : (isAdminView
                                            ? 'text-red-500 hover:text-red-700 border-red-200 hover:bg-red-50'
                                            : 'text-red-500 hover:text-red-700 border-red-200 hover:bg-red-50')}`}
                                >
                                    {isAdminView ? 'Delete' : 'Cancel'}
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default BookingList;
