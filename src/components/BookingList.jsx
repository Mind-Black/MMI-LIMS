import React, { useMemo, useState } from 'react';
import Icon from './Icon';
import { groupBookings } from '../utils/bookingUtils';

const BookingList = ({
    bookings = [],
    onCancel,
    onEdit,
    isAdminView = false,
    readOnly = false,
    isFiltered = false,
    onClearFilters,
    emptyMessage,
    showSort = false
}) => {
    const [sortOrder, setSortOrder] = useState('newest');
    const groupedBookings = useMemo(() => {
        const grouped = groupBookings(bookings);
        return sortOrder === 'oldest' ? [...grouped].reverse() : grouped;
    }, [bookings, sortOrder]);

    return (
        <div className="space-y-4">
            {(isAdminView || showSort) && (
                <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
                        <span>Sort:</span>
                        <select
                            value={sortOrder}
                            onChange={e => setSortOrder(e.target.value)}
                            className="select-input text-xs py-1 px-2.5 min-h-[34px]"
                        >
                            <option value="newest">Newest first</option>
                            <option value="oldest">Oldest first</option>
                        </select>
                    </label>
                    <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">
                        {groupedBookings.length} {groupedBookings.length === 1 ? 'booking' : 'bookings'}
                    </span>
                </div>
            )}

            {groupedBookings.length === 0 ? (
                <div className="p-8 text-center border dark:border-gray-700 rounded-xl bg-gray-50/50 dark:bg-gray-800/30 text-gray-500 dark:text-gray-400">
                    <Icon className="fas fa-calendar-times text-3xl mb-2 opacity-40 block mx-auto" />
                    <p className="text-sm font-medium">
                        {emptyMessage || (isFiltered ? 'No bookings match these filters.' : isAdminView ? 'No bookings found in the system.' : 'No bookings found.')}
                    </p>
                    {isFiltered && onClearFilters && (
                        <button
                            type="button"
                            onClick={onClearFilters}
                            className="mt-3 text-xs text-blue-600 dark:text-blue-400 underline font-semibold cursor-pointer"
                        >
                            Clear filters
                        </button>
                    )}
                </div>
            ) : (
                <div className="space-y-3">
                    {groupedBookings.map(b => (
                        <div
                            key={b.ids[0]}
                            className={`card p-4 transition-all hover:shadow-sm flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 ${
                                readOnly ? 'opacity-80 bg-gray-50/50 dark:bg-gray-900/40' : ''
                            }`}
                        >
                            <div className="space-y-1.5 min-w-0 flex-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <span className={`font-bold text-base ${readOnly ? 'text-gray-700 dark:text-gray-300' : 'text-gray-900 dark:text-gray-100'}`}>
                                        {b.tool_name}
                                    </span>
                                    {b.status === 'pending_approval' ? (
                                        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-amber-700 bg-amber-100 dark:bg-amber-900/40 dark:text-amber-300 px-2.5 py-0.5 rounded-full border border-amber-300 dark:border-amber-700 shadow-2xs" title="Waiting for Tool Responsible confirmation. Slot is tentatively held.">
                                            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>
                                            Pending Approval
                                        </span>
                                    ) : (
                                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 bg-emerald-50 dark:bg-emerald-950/30 dark:text-emerald-300 px-2 py-0.5 rounded-full">
                                            <Icon className="fas fa-check text-[9px]" /> Confirmed
                                        </span>
                                    )}
                                </div>

                                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-600 dark:text-gray-400">
                                    {isAdminView && (
                                        <span className="font-semibold text-gray-800 dark:text-gray-200 flex items-center gap-1">
                                            <Icon className="fas fa-user text-[10px] text-gray-400" />
                                            {b.user_name}
                                        </span>
                                    )}
                                    <span className="flex items-center gap-1 font-medium">
                                        <Icon className="fas fa-calendar-day text-[10px] text-gray-400" />
                                        {b.date}
                                    </span>
                                    <span className="flex items-center gap-1 font-mono">
                                        <Icon className="fas fa-clock text-[10px] text-gray-400" />
                                        {b.startTime} – {b.endTime}
                                    </span>
                                    <span className="flex items-center gap-1">
                                        <Icon className="fas fa-folder text-[10px] text-gray-400" />
                                        {b.project || 'General'}
                                    </span>
                                </div>
                            </div>

                            <div className="flex items-center gap-2 shrink-0 self-stretch sm:self-auto justify-end pt-2 sm:pt-0 border-t sm:border-t-0 border-gray-100 dark:border-gray-800">
                                <button
                                    type="button"
                                    onClick={() => onEdit(b)}
                                    disabled={readOnly}
                                    className={`btn btn-sm min-h-[38px] px-3 text-xs flex items-center gap-1.5 cursor-pointer ${
                                        readOnly
                                            ? 'border border-gray-200 text-gray-400 cursor-not-allowed'
                                            : 'btn-outline-primary border-blue-200 text-blue-600 hover:bg-blue-50 dark:border-blue-800 dark:text-blue-400 dark:hover:bg-blue-900/30'
                                    }`}
                                >
                                    <Icon className="fas fa-edit text-xs" />
                                    <span>Edit</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => onCancel(b.ids)}
                                    disabled={readOnly}
                                    className={`btn btn-sm min-h-[38px] px-3 text-xs flex items-center gap-1.5 cursor-pointer ${
                                        readOnly
                                            ? 'border border-gray-200 text-gray-400 cursor-not-allowed'
                                            : 'btn-outline-danger'
                                    }`}
                                >
                                    <Icon className={isAdminView ? "fas fa-trash-alt text-xs" : "fas fa-times text-xs"} />
                                    <span>{isAdminView ? 'Delete' : 'Cancel'}</span>
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
