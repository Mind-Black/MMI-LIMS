import React, { useMemo, useState } from 'react';
import { groupBookings } from '../utils/bookingUtils';

const BookingList = ({ bookings, onCancel, onEdit, isAdminView = false, readOnly = false, isFiltered = false, onClearFilters, emptyMessage, showSort = false }) => {
    const [sortOrder, setSortOrder] = useState('newest');
    const groupedBookings = useMemo(() => {
        const grouped = groupBookings(bookings);
        return sortOrder === 'oldest' ? [...grouped].reverse() : grouped;
    }, [bookings, sortOrder]);

    return (
        <div className="space-y-6">
            {(isAdminView || showSort) && <label className="block text-sm text-gray-700 dark:text-gray-300">Sort bookings
                <select value={sortOrder} onChange={e => setSortOrder(e.target.value)} className="select-input ml-2 text-sm">
                    <option value="newest">Newest first</option><option value="oldest">Oldest first</option>
                </select>
            </label>}
            {groupedBookings.length === 0 ? (
                <div className="text-gray-600 dark:text-gray-300 transition-colors text-sm">
                    <p>{emptyMessage || (isFiltered ? 'No bookings match these filters.' : isAdminView ? 'No bookings found in the system.' : 'No bookings found.')}</p>
                    {isFiltered && onClearFilters && <button onClick={onClearFilters} className="mt-2 text-blue-700 dark:text-blue-300 underline">Clear filters</button>}
                </div>
            ) : (
                <div className="space-y-2">
                    {groupedBookings.map(b => (
                        <div key={b.ids[0]} className={`card p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 sm:gap-0 ${readOnly ? 'opacity-75 bg-gray-50 dark:bg-gray-900' : ''}`}>
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
                                    className={`btn btn-sm cursor-pointer ${readOnly
                                        ? 'border border-gray-200 text-gray-400 cursor-not-allowed'
                                        : 'btn-outline-primary border-blue-200 text-blue-600 hover:bg-blue-50'}`}
                                >
                                    Edit
                                </button>
                                <button
                                    onClick={() => onCancel(b.ids)}
                                    disabled={readOnly}
                                    className={`btn btn-sm ${readOnly
                                        ? 'border border-gray-200 text-gray-400 cursor-not-allowed'
                                        : 'btn-outline-danger'}`}
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
