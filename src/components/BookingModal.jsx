import React, { useState, useMemo } from 'react';
import StatusBadge from './StatusBadge';
import { useToast } from '../context/ToastContext';
import { getNextSlotTime } from '../utils/bookingUtils';

const BookingModal = ({ tool, user, profile, onClose, onConfirm, existingBookings = [] }) => {
    // Initialize week start to current week's Monday
    const [currentWeekStart, setCurrentWeekStart] = useState(() => {
        const d = new Date();
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday
        return new Date(d.setDate(diff));
    });

    const [selectedSlots, setSelectedSlots] = useState([]); // Array of {date, time}
    const [isDragging, setIsDragging] = useState(false);
    const [dragStart, setDragStart] = useState(null); // {dIndex, tIndex}
    const [isSubmitting, setIsSubmitting] = useState(false);

    const { showToast } = useToast();

    console.log('BookingModal Rendered', { tool, user, profile, existingBookings });

    // Validation
    const isAdmin = profile?.access_level === 'admin';
    const hasLicense = Array.isArray(profile?.licenses) ? profile.licenses.includes(tool.id) : false;
    const isToolUp = tool.status === 'up';
    const canBook = isAdmin || (hasLicense && isToolUp);

    // Helper to get dates for the week
    const weekDates = useMemo(() => {
        const dates = [];
        try {
            for (let i = 0; i < 7; i++) {
                const d = new Date(currentWeekStart);
                d.setDate(currentWeekStart.getDate() + i);
                dates.push(d);
            }
        } catch (e) {
            console.error('Error generating week dates', e);
        }
        return dates;
    }, [currentWeekStart]);

    // Helper to generate 30-min slots from 08:00 to 20:00
    const timeSlots = useMemo(() => {
        const slots = [];
        for (let h = 8; h < 20; h++) {
            const hStr = h < 10 ? '0' + h : h;
            slots.push(`${hStr}:00`);
            slots.push(`${hStr}:30`);
        }
        return slots;
    }, []);

    const formatDate = (date) => {
        try {
            return date.toISOString().split('T')[0];
        } catch (e) {
            return '';
        }
    };
    const displayDate = (date) => {
        try {
            return date.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' });
        } catch (e) {
            return 'Invalid Date';
        }
    };

    const isSlotBooked = (dateStr, timeStr) => {
        return existingBookings.some(b => b.date === dateStr && b.time.slice(0, 5) === timeStr && b.tool_id === tool.id);
    };

    const getBooking = (dateStr, timeStr) => {
        return existingBookings.find(b => b.date === dateStr && b.time.slice(0, 5) === timeStr && b.tool_id === tool.id);
    };

    const isSlotSelected = (dateStr, timeStr) => {
        return selectedSlots.some(s => s.date === dateStr && s.time === timeStr);
    };

    // Indices lookup
    const getDateIndex = (dateStr) => weekDates.findIndex(d => formatDate(d) === dateStr);
    const getTimeIndex = (time) => timeSlots.indexOf(time);

    // Drag Handlers
    const handleMouseDown = (dateStr, time) => {
        if (!canBook || isSlotBooked(dateStr, time)) return;

        setIsDragging(true);
        const dIndex = getDateIndex(dateStr);
        const tIndex = getTimeIndex(time);
        setDragStart({ dIndex, tIndex });
        setSelectedSlots([{ date: dateStr, time }]);
    };

    const handleMouseEnter = (dateStr, time) => {
        if (!isDragging || !dragStart) return;

        const currentDIndex = getDateIndex(dateStr);
        const currentTIndex = getTimeIndex(time);

        // Calculate rectangular range
        const minD = Math.min(dragStart.dIndex, currentDIndex);
        const maxD = Math.max(dragStart.dIndex, currentDIndex);
        const minT = Math.min(dragStart.tIndex, currentTIndex);
        const maxT = Math.max(dragStart.tIndex, currentTIndex);

        const newSelection = [];

        // Iterate range
        for (let d = minD; d <= maxD; d++) {
            for (let t = minT; t <= maxT; t++) {
                const dStr = formatDate(weekDates[d]);
                const tStr = timeSlots[t];
                // Only select if not booked
                if (!isSlotBooked(dStr, tStr)) {
                    newSelection.push({ date: dStr, time: tStr });
                }
            }
        }
        setSelectedSlots(newSelection);
    };

    const handleMouseUp = () => {
        setIsDragging(false);
        setDragStart(null);
    };

    // Navigation
    const handlePrevWeek = () => {
        const newDate = new Date(currentWeekStart);
        newDate.setDate(newDate.getDate() - 7);
        setCurrentWeekStart(newDate);
        setSelectedSlots([]);
    };

    const handleNextWeek = () => {
        const newDate = new Date(currentWeekStart);
        newDate.setDate(newDate.getDate() + 7);
        setCurrentWeekStart(newDate);
        setSelectedSlots([]);
    };

    const handleConfirm = async () => {
        if (selectedSlots.length === 0) {
            showToast('Please select at least one time slot.', 'error');
            return;
        }

        setIsSubmitting(true);

        const now = new Date().toISOString();

        // Group selected slots into ranges
        const sortedSlots = [...selectedSlots].sort((a, b) => {
            if (a.date !== b.date) return a.date.localeCompare(b.date);
            return a.time.localeCompare(b.time);
        });

        const ranges = [];
        let currentRange = null;

        sortedSlots.forEach(slot => {
            if (!currentRange) {
                currentRange = {
                    date: slot.date,
                    startTime: slot.time,
                    endTime: getNextSlotTime(slot.time)
                };
                return;
            }

            const isSameDate = slot.date === currentRange.date;
            const isContinuous = slot.time === currentRange.endTime;

            if (isSameDate && isContinuous) {
                currentRange.endTime = getNextSlotTime(slot.time);
            } else {
                ranges.push(currentRange);
                currentRange = {
                    date: slot.date,
                    startTime: slot.time,
                    endTime: getNextSlotTime(slot.time)
                };
            }
        });
        if (currentRange) ranges.push(currentRange);

        const newBookings = ranges.map(range => ({
            tool_id: tool.id,
            tool_name: tool.name,
            user_id: user.id,
            user_name: profile ? `${profile.first_name} ${profile.last_name}` : user.email,
            project: user.user_metadata?.project || 'General',
            date: range.date,
            time: range.startTime,
            end_time: range.endTime,
            created_at: now
        }));

        await onConfirm(newBookings);
        setIsSubmitting(false);
    };

    return (
        <div
            className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
            onMouseUp={handleMouseUp} // Catch drops outside grid
        >
            <div className="bg-white rounded-lg shadow-2xl w-full max-w-5xl h-[90vh] flex flex-col overflow-hidden">
                {/* Header */}
                <div className="bg-blue-900 text-white p-4 flex justify-between items-center shrink-0">
                    <h2 className="text-xl font-bold"><i className="fas fa-calendar-alt mr-2"></i>Weekly Schedule</h2>
                    <button onClick={onClose} className="hover:text-gray-300"><i className="fas fa-times text-xl"></i></button>
                </div>

                {/* Tool Info & Controls */}
                <div className="p-4 border-b bg-gray-50 flex justify-between items-center shrink-0">
                    <div>
                        <h3 className="font-bold text-lg text-gray-800">{tool.name}</h3>
                        <div className="flex gap-2 text-sm mt-1">
                            <StatusBadge status={tool.status} />
                            {hasLicense ?
                                <span className="text-green-700 bg-green-100 px-2 rounded font-bold">Licensed</span> :
                                <span className="text-red-700 bg-red-100 px-2 rounded font-bold">No License</span>
                            }
                        </div>
                    </div>
                    <div className="flex items-center gap-4">
                        <button onClick={handlePrevWeek} className="p-2 hover:bg-gray-200 rounded"><i className="fas fa-chevron-left"></i></button>
                        <div className="font-bold text-gray-700 w-48 text-center">
                            {weekDates[0].toLocaleDateString()} - {weekDates[6].toLocaleDateString()}
                        </div>
                        <button onClick={handleNextWeek} className="p-2 hover:bg-gray-200 rounded"><i className="fas fa-chevron-right"></i></button>
                    </div>
                </div>

                {!canBook && (
                    <div className="bg-red-50 border-b border-red-200 p-2 text-center text-red-700 text-sm font-bold shrink-0">
                        {!isToolUp ? "Tool is currently down for maintenance." : "You do not have a license for this tool."}
                    </div>
                )}
                {isAdmin && !hasLicense && (
                    <div className="bg-yellow-50 border-b border-yellow-200 p-2 text-center text-yellow-800 text-sm font-bold shrink-0">
                        <i className="fas fa-shield-alt mr-2"></i> Admin Override: You are booking without a license.
                    </div>
                )}

                {/* Calendar Grid Container */}
                <div className="flex-1 overflow-auto custom-scroll relative select-none">
                    <div className="min-w-[800px]">

                        {/* Header Row (Days) */}
                        <div className="grid grid-cols-[80px_repeat(7,1fr)] bg-white border-b sticky top-0 z-20 shadow-sm">
                            <div className="p-2 border-r bg-gray-50"></div>
                            {weekDates.map((date, i) => (
                                <div key={i} className="p-2 text-center border-r font-semibold text-gray-700 text-sm bg-gray-50">
                                    {displayDate(date)}
                                </div>
                            ))}
                        </div>

                        {/* Body Rows (Time Slots) */}
                        {timeSlots.map(time => (
                            <div key={time} className="grid grid-cols-[80px_repeat(7,1fr)] border-b last:border-0 h-12">
                                {/* Time Label */}
                                <div className="p-2 text-right text-xs text-gray-500 border-r bg-gray-50 font-mono flex items-center justify-end sticky left-0 z-10">
                                    {time}
                                </div>

                                {/* Slots */}
                                {weekDates.map((date, i) => {
                                    const dateStr = formatDate(date);
                                    const booking = getBooking(dateStr, time);
                                    const isBooked = !!booking;
                                    const selected = isSlotSelected(dateStr, time);

                                    let cellClass = "bg-white cursor-pointer hover:bg-blue-50";
                                    if (isBooked) cellClass = "bg-gray-200 cursor-not-allowed";
                                    else if (selected) cellClass = "bg-blue-600 text-white";
                                    else if (!canBook) cellClass = "bg-gray-50 cursor-not-allowed";

                                    return (
                                        <div
                                            key={`${dateStr}-${time}`}
                                            onMouseDown={() => handleMouseDown(dateStr, time)}
                                            onMouseEnter={() => handleMouseEnter(dateStr, time)}
                                            className={`border-r p-1 transition-colors flex items-center justify-center text-xs overflow-hidden ${cellClass}`}
                                            title={isBooked ? `Booked by: ${booking.user_name}\nProject: ${booking.project}` : ''}
                                        >
                                            {isBooked && (
                                                <span className="text-gray-600 font-semibold text-[10px] truncate w-full text-center">
                                                    {booking.user_name}
                                                </span>
                                            )}
                                            {selected && <span className="font-bold">SELECTED</span>}
                                        </div>
                                    );
                                })}
                            </div>
                        ))}
                    </div>
                </div>

                {/* Footer */}
                <div className="p-4 border-t bg-white flex justify-end gap-3 shrink-0 z-30">
                    <div className="mr-auto flex items-center gap-4 text-sm">
                        <div className="flex items-center gap-1"><div className="w-4 h-4 bg-white border"></div> Available</div>
                        <div className="flex items-center gap-1"><div className="w-4 h-4 bg-blue-600 rounded"></div> Selected ({selectedSlots.length})</div>
                        <div className="flex items-center gap-1"><div className="w-4 h-4 bg-gray-200 rounded"></div> Booked</div>
                    </div>
                    <button onClick={onClose} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded">Cancel</button>
                    <button
                        disabled={selectedSlots.length === 0 || isSubmitting}
                        onClick={handleConfirm}
                        className={`px-6 py-2 rounded text-white font-bold transition flex items-center gap-2 ${selectedSlots.length === 0 || isSubmitting ? 'bg-gray-300 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'}`}
                    >
                        {isSubmitting && <i className="fas fa-spinner fa-spin"></i>}
                        {isSubmitting ? 'Booking...' : 'Confirm Booking'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default BookingModal;
