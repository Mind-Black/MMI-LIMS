import React, { useState, useMemo, useEffect, useRef } from 'react';
import StatusBadge from './StatusBadge';
import { useToast } from '../context/ToastContext';
import { getNextSlotTime, groupBookings, checkCollision, calculateEventLayout } from '../utils/bookingUtils';

const BookingModal = ({ tool, user, profile, onClose, onConfirm, onUpdate, existingBookings = [], initialDate }) => {
    // Initialize week start to current week's Monday
    const [currentWeekStart, setCurrentWeekStart] = useState(() => {
        const d = initialDate ? new Date(initialDate) : new Date();
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday
        return new Date(d.setDate(diff));
    });

    const [selectedSlots, setSelectedSlots] = useState([]); // Array of {date, time}
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Interaction State (for moving/resizing existing bookings)
    const [interaction, setInteraction] = useState(null);
    const interactionRef = useRef(null);

    // Selection State (for creating new bookings)
    const [isSelecting, setIsSelecting] = useState(false);
    const selectionRef = useRef(null); // { startDIndex, startTIndex, currentDIndex, currentTIndex }

    const { showToast } = useToast();

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
    const getMinutes = (timeStr) => {
        const [h, m] = timeStr.split(':').map(Number);
        return (h * 60) + m;
    };

    const isSlotInPast = (dateStr, timeStr) => {
        const now = new Date();
        const slotDate = new Date(`${dateStr}T${timeStr}`);
        return slotDate < now;
    };

    const isSlotBooked = (dateStr, timeStr) => {
        const slotStart = getMinutes(timeStr);
        const slotEnd = slotStart + 30;

        return existingBookings.some(b => {
            if (b.date !== dateStr || b.tool_id !== tool.id) return false;

            const bStart = getMinutes(b.startTime || b.time);
            let bEnd;
            const endTimeStr = b.endTime || b.end_time;
            if (endTimeStr) {
                bEnd = getMinutes(endTimeStr);
            } else {
                bEnd = bStart + 30;
            }

            return (slotStart < bEnd && slotEnd > bStart);
        });
    };

    // Group bookings for display
    const groupedBookings = useMemo(() => {
        // Filter for this tool only
        const toolBookings = existingBookings.filter(b => b.tool_id === tool.id);
        return groupBookings(toolBookings);
    }, [existingBookings, tool.id]);

    const PIXELS_PER_30_MINS = 48;
    const START_HOUR = 8;

    const getEventStyle = (booking) => {
        const startHour = parseInt(booking.startTime.split(':')[0]);
        const startMin = parseInt(booking.startTime.split(':')[1]);
        const endHour = parseInt(booking.endTime.split(':')[0]);
        const endMin = parseInt(booking.endTime.split(':')[1]);

        const startOffset = (startHour - START_HOUR) * 60 + startMin;
        const endOffset = (endHour - START_HOUR) * 60 + endMin;
        const duration = endOffset - startOffset;

        const top = (startOffset / 30) * PIXELS_PER_30_MINS;
        const height = (duration / 30) * PIXELS_PER_30_MINS;

        return {
            top: `${top}px`,
            height: `${height - 1}px`,
            left: booking.left !== undefined ? `${booking.left}%` : '2px',
            width: booking.width !== undefined ? `${booking.width}%` : 'calc(100% - 4px)',
            position: 'absolute',
            zIndex: 10
        };
    };

    // --- Interaction Handlers (Move/Resize Existing) ---

    const handleBookingMouseDown = (e, booking, type) => {
        e.stopPropagation();

        // Permission check: Can only edit own bookings unless admin
        const isOwnBooking = booking.user_id === user.id;
        if (!isAdmin && !isOwnBooking) {
            showToast('You can only edit your own bookings.', 'error');
            return;
        }

        const now = new Date();
        const bookingEnd = new Date(`${booking.date}T${booking.endTime}`);
        if (bookingEnd < now) {
            showToast('Cannot modify past bookings.', 'error');
            return;
        }

        const rect = e.currentTarget.parentElement.getBoundingClientRect();
        const initialData = {
            type,
            bookingId: booking.ids[0],
            originalBooking: booking,
            startY: e.clientY,
            startX: e.clientX,
            initialTop: parseFloat(getEventStyle(booking).top),
            initialHeight: parseFloat(getEventStyle(booking).height),
            currentTop: parseFloat(getEventStyle(booking).top),
            currentHeight: parseFloat(getEventStyle(booking).height),
            currentDate: booking.date,
            dayWidth: rect.width
        };

        interactionRef.current = initialData;
        setInteraction(initialData);
    };

    // --- Selection Handlers (Create New) ---

    const handleGridMouseDown = (dateStr, timeIndex) => {
        if (!canBook) return;

        // Don't start selection if clicking on an existing booking (handled by stopPropagation, but safety check)
        const timeStr = timeSlots[timeIndex];
        if (isSlotBooked(dateStr, timeStr)) return;
        if (isSlotInPast(dateStr, timeStr)) {
            showToast('Cannot book in the past.', 'error');
            return;
        }

        setIsSelecting(true);
        const dIndex = weekDates.findIndex(d => formatDate(d) === dateStr);

        const initialSelection = {
            startDIndex: dIndex,
            startTIndex: timeIndex,
            currentDIndex: dIndex,
            currentTIndex: timeIndex
        };

        selectionRef.current = initialSelection;
        updateSelectedSlots(initialSelection);
    };

    const handleMouseEnter = (dateStr, timeIndex) => {
        if (isSelecting && selectionRef.current) {
            const dIndex = weekDates.findIndex(d => formatDate(d) === dateStr);

            // Update current position
            selectionRef.current.currentDIndex = dIndex;
            selectionRef.current.currentTIndex = timeIndex;

            updateSelectedSlots(selectionRef.current);
        }
    };

    const updateSelectedSlots = (sel) => {
        const minD = Math.min(sel.startDIndex, sel.currentDIndex);
        const maxD = Math.max(sel.startDIndex, sel.currentDIndex);
        const minT = Math.min(sel.startTIndex, sel.currentTIndex);
        const maxT = Math.max(sel.startTIndex, sel.currentTIndex);

        const newSlots = [];
        for (let d = minD; d <= maxD; d++) {
            for (let t = minT; t <= maxT; t++) {
                const dStr = formatDate(weekDates[d]);
                const tStr = timeSlots[t];
                if (!isSlotBooked(dStr, tStr) && !isSlotInPast(dStr, tStr)) {
                    newSlots.push({ date: dStr, time: tStr });
                }
            }
        }
        setSelectedSlots(newSlots);
    };

    // --- Global Mouse Handlers ---

    useEffect(() => {
        const handleMouseMove = (e) => {
            // Handle Interaction (Move/Resize)
            if (interactionRef.current) {
                const data = interactionRef.current;
                const deltaY = e.clientY - data.startY;
                const deltaX = e.clientX - data.startX;
                const snappedDeltaY = Math.round(deltaY / PIXELS_PER_30_MINS) * PIXELS_PER_30_MINS;

                let dayIndexDelta = 0;
                if (data.type === 'move') {
                    dayIndexDelta = Math.round(deltaX / data.dayWidth);
                }

                let newTop = data.initialTop;
                let newHeight = data.initialHeight;
                let newDate = data.currentDate;

                if (data.type === 'move') {
                    newTop += snappedDeltaY;
                    const currentDayIndex = weekDates.findIndex(d => formatDate(d) === data.originalBooking.date);
                    const newDayIndex = currentDayIndex + dayIndexDelta;
                    if (newDayIndex >= 0 && newDayIndex < 7) {
                        newDate = formatDate(weekDates[newDayIndex]);
                    }
                } else if (data.type === 'resize-bottom') {
                    newHeight += snappedDeltaY;
                } else if (data.type === 'resize-top') {
                    newTop += snappedDeltaY;
                    newHeight -= snappedDeltaY;
                }

                if (newHeight < PIXELS_PER_30_MINS) {
                    const heightDiff = PIXELS_PER_30_MINS - newHeight;
                    newHeight = PIXELS_PER_30_MINS;
                    if (data.type === 'resize-top') newTop -= heightDiff;
                }

                const newData = { ...data, currentTop: newTop, currentHeight: newHeight, currentDate: newDate };
                interactionRef.current = newData;
                setInteraction(newData);
            }
        };

        const handleMouseUp = async () => {
            // End Selection
            if (isSelecting) {
                setIsSelecting(false);
                selectionRef.current = null;
            }

            // End Interaction
            if (interactionRef.current) {
                const data = interactionRef.current;

                // Calculate new times
                const startOffsetMins = (data.currentTop / PIXELS_PER_30_MINS) * 30;
                const durationMins = (data.currentHeight / PIXELS_PER_30_MINS) * 30;
                const roundTo30 = (mins) => Math.round(mins / 30) * 30;
                const startTotalMins = roundTo30((START_HOUR * 60) + startOffsetMins);
                const endTotalMins = roundTo30(startTotalMins + durationMins);

                const formatTime = (totalMins) => {
                    let h = Math.floor(totalMins / 60);
                    let m = Math.round(totalMins % 60);
                    if (m === 60) { h += 1; m = 0; }
                    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
                };

                const newStartTime = formatTime(startTotalMins);
                const newEndTime = formatTime(endTotalMins);

                // Validation
                const now = new Date();
                const newStartDateTime = new Date(`${data.currentDate}T${newStartTime}`);
                const isValidTime = startTotalMins >= (8 * 60) && endTotalMins <= (20 * 60);
                const isFuture = newStartDateTime >= now;

                const isActive = new Date(`${data.originalBooking.date}T${data.originalBooking.startTime}`) <= now && new Date(`${data.originalBooking.date}T${data.originalBooking.endTime}`) > now;
                const isEndTimeValid = !isActive || new Date(`${data.currentDate}T${newEndTime}`) > now;

                if (isValidTime && isFuture && isEndTimeValid) {
                    const newBooking = {
                        date: data.currentDate,
                        startTime: newStartTime,
                        endTime: newEndTime,
                        tool_id: data.originalBooking.tool_id
                    };

                    const hasCollision = checkCollision(newBooking, existingBookings, data.originalBooking.ids);

                    if (!hasCollision) {
                        await onUpdate(data.originalBooking.ids, newBooking);
                    } else {
                        showToast('Booking overlaps with another booking.', 'error');
                    }
                } else {
                    if (!isValidTime) showToast('Booking is outside of operating hours.', 'error');
                    else if (!isFuture) showToast('Cannot move booking to the past.', 'error');
                    else if (!isEndTimeValid) showToast('Cannot shorten active booking end time to be in the past.', 'error');
                }

                setInteraction(null);
                interactionRef.current = null;
            }
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);

        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isSelecting, existingBookings, onUpdate, showToast]);


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

    const handleConfirmBooking = async () => {
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
                currentRange = { date: slot.date, startTime: slot.time, endTime: getNextSlotTime(slot.time) };
                return;
            }
            const isSameDate = slot.date === currentRange.date;
            const isContinuous = slot.time === currentRange.endTime;

            if (isSameDate && isContinuous) {
                currentRange.endTime = getNextSlotTime(slot.time);
            } else {
                ranges.push(currentRange);
                currentRange = { date: slot.date, startTime: slot.time, endTime: getNextSlotTime(slot.time) };
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

        // Final Collision Check
        const hasCollision = newBookings.some(newB => checkCollision(newB, existingBookings));

        if (hasCollision) {
            showToast('One or more selected slots are already booked.', 'error');
            setIsSubmitting(false);
            return;
        }

        await onConfirm(newBookings);
        setIsSubmitting(false);
        setSelectedSlots([]);
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
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

                {/* Calendar Grid Container */}
                <div className="flex-1 overflow-auto custom-scroll relative select-none">
                    <div className="min-w-[800px] flex">

                        {/* Time Labels Column */}
                        <div className="w-[50px] shrink-0 bg-gray-50 border-r sticky left-0 z-30">
                            <div className="h-10 border-b bg-gray-50"></div>
                            {timeSlots.map(time => (
                                <div key={time} className="h-12 border-b text-right pr-2 text-xs text-gray-500 font-mono flex items-center justify-end">
                                    {time}
                                </div>
                            ))}
                        </div>

                        {/* Days Columns */}
                        <div className="flex-1 flex">
                            {weekDates.map((date, i) => {
                                const dateStr = formatDate(date);
                                const dayBookings = groupedBookings.filter(b => b.date === dateStr);
                                const positionedBookings = calculateEventLayout(dayBookings);

                                // Check if this day is the target of the current interaction
                                const isTargetDay = interaction && interaction.currentDate === dateStr;
                                const interactingBooking = interaction && interaction.originalBooking;

                                return (
                                    <div key={i} className="flex-1 min-w-[100px] border-r last:border-0 relative">
                                        {/* Day Header */}
                                        <div className="h-10 border-b bg-gray-50 text-center font-semibold text-gray-700 text-sm flex items-center justify-center sticky top-0 z-20">
                                            {displayDate(date)}
                                        </div>

                                        {/* Grid Lines & Slots */}
                                        <div className="relative">
                                            {timeSlots.map((time, tIndex) => {
                                                const isSelected = selectedSlots.some(s => s.date === dateStr && s.time === time);
                                                const isPast = isSlotInPast(dateStr, time);
                                                return (
                                                    <div
                                                        key={time}
                                                        className={`h-12 border-b ${isSelected ? 'bg-blue-200' : ''} ${isPast ? 'bg-gray-100 cursor-not-allowed' : ''}`}
                                                        onMouseDown={() => handleGridMouseDown(dateStr, tIndex)}
                                                        onMouseEnter={() => handleMouseEnter(dateStr, tIndex)}
                                                    ></div>
                                                );
                                            })}

                                            {/* Existing Bookings Overlay */}
                                            {positionedBookings.map(booking => {
                                                const isInteracting = interaction && interaction.bookingId === booking.ids[0];
                                                if (isInteracting) return null;

                                                const isOwnBooking = booking.user_id === user.id;
                                                const canEdit = isAdmin || isOwnBooking;

                                                return (
                                                    <div
                                                        key={booking.ids[0]}
                                                        className={`absolute border rounded p-1 text-xs overflow-hidden transition-shadow group 
                                                            ${isOwnBooking ? 'bg-blue-100 border-blue-300' : 'bg-gray-100 border-gray-300'}
                                                            ${canEdit ? 'hover:z-10 hover:shadow-md cursor-pointer' : ''}`}
                                                        style={getEventStyle(booking)}
                                                        onMouseDown={(e) => canEdit && handleBookingMouseDown(e, booking, 'move')}
                                                        title={`Booked by: ${booking.user_name}\nProject: ${booking.project}`}
                                                    >
                                                        {canEdit && (
                                                            <div
                                                                className="absolute top-0 left-0 right-0 h-2 cursor-ns-resize opacity-0 group-hover:opacity-100 bg-blue-400/20"
                                                                onMouseDown={(e) => { e.stopPropagation(); handleBookingMouseDown(e, booking, 'resize-top'); }}
                                                            ></div>
                                                        )}

                                                        <div className={`font-bold truncate pointer-events-none ${isOwnBooking ? 'text-blue-900' : 'text-gray-800'}`}>{booking.user_name}</div>
                                                        <div className={`truncate text-[10px] pointer-events-none ${isOwnBooking ? 'text-blue-700' : 'text-gray-600'}`}>{booking.project}</div>

                                                        {canEdit && (
                                                            <div
                                                                className="absolute bottom-0 left-0 right-0 h-2 cursor-ns-resize opacity-0 group-hover:opacity-100 bg-blue-400/20"
                                                                onMouseDown={(e) => { e.stopPropagation(); handleBookingMouseDown(e, booking, 'resize-bottom'); }}
                                                            ></div>
                                                        )}
                                                    </div>
                                                );
                                            })}

                                            {/* Interaction Ghost */}
                                            {isTargetDay && (
                                                <div
                                                    className="absolute bg-blue-200 border border-blue-500 border-dashed rounded p-1 text-xs overflow-hidden z-50 opacity-80 pointer-events-none"
                                                    style={{
                                                        top: `${interaction.currentTop}px`,
                                                        height: `${interaction.currentHeight - 1}px`,
                                                        left: '2px',
                                                        right: '2px'
                                                    }}
                                                >
                                                    <div className="font-bold text-blue-900 truncate">{interactingBooking.user_name}</div>
                                                    <div className="text-blue-700 truncate text-[10px]">{interactingBooking.project}</div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="p-4 border-t bg-white flex justify-end gap-3 shrink-0 z-30">
                    <div className="mr-auto flex items-center gap-4 text-sm">
                        <div className="flex items-center gap-1"><div className="w-4 h-4 bg-white border"></div> Available</div>
                        <div className="flex items-center gap-1"><div className="w-4 h-4 bg-blue-200 rounded"></div> Selected</div>
                        <div className="flex items-center gap-1"><div className="w-4 h-4 bg-blue-100 border border-blue-300 rounded"></div> My Booking</div>
                        <div className="flex items-center gap-1"><div className="w-4 h-4 bg-gray-100 border border-gray-300 rounded"></div> Other's Booking</div>
                    </div>
                    <button onClick={onClose} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded">Cancel</button>
                    <button
                        disabled={selectedSlots.length === 0 || isSubmitting}
                        onClick={handleConfirmBooking}
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
