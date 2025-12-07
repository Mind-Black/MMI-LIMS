import React, { useMemo } from 'react';

import { groupBookings } from '../utils/bookingUtils';

const BookingList = ({ bookings, onCancel, onUpdate, onEdit, allBookings, isAdminView = false, readOnly = false }) => {

    const groupedBookings = useMemo(() => groupBookings(bookings), [bookings]);

    return (
        <div className="space-y-6">

            {groupedBookings.length === 0 ? (
                <p className="text-gray-500 dark:text-gray-400 transition-colors">
                    {isAdminView ? 'No bookings found in the system.' : 'No bookings found.'}
                </p>
            ) : (
                <div className="space-y-2">
                    {groupedBookings.map(b => (
                        <div key={b.ids[0]} className={`bg-white dark:bg-gray-800 p-4 rounded shadow-sm border dark:border-gray-700 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 sm:gap-0 transition-colors ${readOnly ? 'opacity-75 bg-gray-50 dark:bg-gray-900' : ''}`}>
                            <div>
                                <div className={`font-bold ${readOnly ? 'text-gray-700 dark:text-gray-300' : 'text-blue-900 dark:text-blue-100'}`}>{b.tool_name}</div>
                                <div className="text-sm text-gray-600 dark:text-gray-400">
                                    {isAdminView && (
                                        <span className="font-semibold text-gray-800 dark:text-gray-200 mr-1">{b.user_name} |</span>
                                    )}
                                    {b.date} | {b.startTime} - {b.endTime}
                                </div>
                                {isAdminView && (
                                    <div className="text-xs text-gray-500 dark:text-gray-500">Project: {b.project}</div>
                                )}
                            </div>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => onEdit(b)}
                                    disabled={readOnly}
                                    className={`text-sm font-semibold border px-3 py-1 rounded transition-colors ${readOnly
                                        ? 'text-gray-400 dark:text-gray-600 border-gray-200 dark:border-gray-700 cursor-not-allowed'
                                        : 'text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 border-blue-200 dark:border-blue-800 hover:bg-blue-50 dark:hover:bg-blue-900/30'}`}
                                >
                                    Edit
                                </button>
                                <button
                                    onClick={() => onCancel(b.ids)}
                                    disabled={readOnly}
                                    className={`text-sm font-semibold border px-3 py-1 rounded transition-colors ${readOnly
                                        ? 'text-gray-400 dark:text-gray-600 border-gray-200 dark:border-gray-700 cursor-not-allowed'
                                        : (isAdminView
                                            ? 'text-red-500 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 border-red-200 dark:border-red-800 hover:bg-red-50 dark:hover:bg-red-900/20'
                                            : 'text-red-500 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 border-red-200 dark:border-red-800 hover:bg-red-50 dark:hover:bg-red-900/20')}`}
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
