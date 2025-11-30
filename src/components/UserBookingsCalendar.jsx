import React, { useState, useMemo, useEffect, useRef } from 'react';
import { groupBookings, checkCollision, calculateEventLayout } from '../utils/bookingUtils';

const UserBookingsCalendar = ({ bookings, allBookings, onUpdate }) => {
    // Initialize week start to current week's Monday
    const [currentWeekStart, setCurrentWeekStart] = useState(() => {
        const d = new Date();
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday
        return new Date(d.setDate(diff));
    });

    // Interaction State
    const [interaction, setInteraction] = useState(null);
    const interactionRef = useRef(null); // Store data for event handlers

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

    // Group bookings for display
    const groupedBookings = useMemo(() => {
        return groupBookings(bookings);
    }, [bookings]);

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
            height: `${height - 1}px`, // -1 for border/gap
            left: booking.left !== undefined ? `${booking.left}%` : '2px',
            width: booking.width !== undefined ? `${booking.width}%` : 'calc(100% - 4px)',
            position: 'absolute',
            zIndex: 10
        };
    };

    // Interaction Handlers
    const handleMouseDown = (e, booking, type) => {
        console.log('MouseDown:', type, booking.ids[0]);
        e.stopPropagation(); // Prevent bubbling

        if (!onUpdate) {
            console.error('onUpdate prop is missing!');
            return;
        }

        // Check constraints
        const now = new Date();
        const bookingStart = new Date(`${booking.date}T${booking.startTime}`);
        const bookingEnd = new Date(`${booking.date}T${booking.endTime}`);

        // Prevent modifying past bookings
        if (bookingEnd < now) {
            console.log('Cannot modify past booking');
            return;
        }

        // Active booking constraints
        const isActive = bookingStart <= now && bookingEnd > now;
        if (isActive) {
            if (type === 'move') {
                console.log('Cannot move active booking');
                return;
            }
            if (type === 'resize-top') {
                console.log('Cannot resize start of active booking');
                return;
            }
        }

        const rect = e.currentTarget.parentElement.getBoundingClientRect();
        const startY = e.clientY;
        const startX = e.clientX;

        const initialData = {
            type,
            bookingId: booking.ids[0],
            originalBooking: booking,
            startY,
            startX,
            initialTop: parseFloat(getEventStyle(booking).top),
            initialHeight: parseFloat(getEventStyle(booking).height),
            currentTop: parseFloat(getEventStyle(booking).top),
            currentHeight: parseFloat(getEventStyle(booking).height),
            currentStartTime: booking.startTime,
            currentEndTime: booking.endTime,
            currentDate: booking.date,
            dayWidth: rect.width
        };

        console.log('Starting interaction', initialData);

        interactionRef.current = initialData;
        setInteraction(initialData);
    };

    useEffect(() => {
        if (!interaction) return;

        const handleMouseMove = (e) => {
            const data = interactionRef.current;
            if (!data) return;

            const deltaY = e.clientY - data.startY;
            const deltaX = e.clientX - data.startX;

            // Snap to grid (30 mins = 64px)
            const snappedDeltaY = Math.round(deltaY / PIXELS_PER_30_MINS) * PIXELS_PER_30_MINS;

            // Calculate Day Change for Move
            let dayIndexDelta = 0;
            if (data.type === 'move') {
                dayIndexDelta = Math.round(deltaX / data.dayWidth);
            }

            let newTop = data.initialTop;
            let newHeight = data.initialHeight;
            let newDate = data.currentDate;

            if (data.type === 'move') {
                newTop += snappedDeltaY;
                // Calculate new date
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

            // Min height constraint (30 mins)
            if (newHeight < PIXELS_PER_30_MINS) {
                const heightDiff = PIXELS_PER_30_MINS - newHeight;
                newHeight = PIXELS_PER_30_MINS;
                if (data.type === 'resize-top') {
                    // If resizing top and hit min height, adjust top to keep bottom fixed
                    newTop -= heightDiff;
                }
            }

            // Update ref with latest values
            interactionRef.current = {
                ...data,
                currentTop: newTop,
                currentHeight: newHeight,
                currentDate: newDate
            };

            // Update state for rendering
            setInteraction(prev => ({
                ...prev,
                currentTop: newTop,
                currentHeight: newHeight,
                currentDate: newDate
            }));
        };

        const handleMouseUp = async () => {
            const data = interactionRef.current;
            if (!data) return;

            console.log('MouseUp Data:', data);

            // Calculate new times based on pixels
            const startOffsetMins = (data.currentTop / PIXELS_PER_30_MINS) * 30;
            const durationMins = (data.currentHeight / PIXELS_PER_30_MINS) * 30;

            // Round to nearest 30 mins to avoid floating point issues
            const roundTo30 = (mins) => Math.round(mins / 30) * 30;

            const startTotalMins = roundTo30((START_HOUR * 60) + startOffsetMins);
            const endTotalMins = roundTo30(startTotalMins + durationMins);

            const formatTime = (totalMins) => {
                let h = Math.floor(totalMins / 60);
                let m = Math.round(totalMins % 60);

                if (m === 60) {
                    h += 1;
                    m = 0;
                }

                return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
            };

            const newStartTime = formatTime(startTotalMins);
            const newEndTime = formatTime(endTotalMins);

            console.log('Calculated Times:', { startTotalMins, endTotalMins, newStartTime, newEndTime });

            // Validation
            const now = new Date();
            const newStartDateTime = new Date(`${data.currentDate}T${newStartTime}`);

            // 1. Check bounds (08:00 - 20:00)
            const isValidTime = startTotalMins >= (8 * 60) && endTotalMins <= (20 * 60);

            // 2. Check past
            const isFuture = newStartDateTime >= now;

            // 3. Active booking constraints (End time must be > now)
            const isActive = new Date(`${data.originalBooking.date}T${data.originalBooking.startTime}`) <= now && new Date(`${data.originalBooking.date}T${data.originalBooking.endTime}`) > now;
            const isEndTimeValid = !isActive || new Date(`${data.currentDate}T${newEndTime}`) > now;

            console.log('Validation:', { isValidTime, isFuture, isEndTimeValid, isActive });

            if (isValidTime && isFuture && isEndTimeValid) {
                // Create new booking object
                const newBooking = {
                    date: data.currentDate,
                    startTime: newStartTime,
                    endTime: newEndTime,
                    tool_id: data.originalBooking.tool_id
                };

                // Check collisions against ALL bookings
                const hasCollision = checkCollision(newBooking, allBookings || bookings, data.originalBooking.ids);

                if (!hasCollision) {
                    console.log('Updating booking...', data.originalBooking.ids, newBooking);
                    // Commit Change
                    await onUpdate(data.originalBooking.ids, newBooking);
                } else {
                    console.log("Collision detected");
                }
            } else {
                console.log("Invalid time or moved to past");
            }

            setInteraction(null);
            interactionRef.current = null;
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);

        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [interaction ? true : false]); // Only run on mount/unmount of interaction


    // Navigation
    const handlePrevWeek = () => {
        const newDate = new Date(currentWeekStart);
        newDate.setDate(newDate.getDate() - 7);
        setCurrentWeekStart(newDate);
    };

    const handleNextWeek = () => {
        const newDate = new Date(currentWeekStart);
        newDate.setDate(newDate.getDate() + 7);
        setCurrentWeekStart(newDate);
    };

    return (
        <div className="bg-white rounded-lg shadow-sm border flex flex-col overflow-hidden h-[600px]">
            {/* Header */}
            <div className="p-1 border-b bg-gray-50 flex justify-between items-center shrink-0">
                <h3 className="font-bold text-gray-800 text-lg">Weekly Schedule</h3>
                <div className="flex items-center gap-4">
                    <button onClick={handlePrevWeek} className="p-2 hover:bg-gray-200 rounded"><i className="fas fa-chevron-left"></i></button>
                    <div className="font-bold text-gray-700 w-48 text-center">
                        {weekDates[0].toLocaleDateString()} - {weekDates[6].toLocaleDateString()}
                    </div>
                    <button onClick={handleNextWeek} className="p-2 hover:bg-gray-200 rounded"><i className="fas fa-chevron-right"></i></button>
                </div>
            </div>

            {/* Calendar Grid Container */}
            <div className="flex-1 overflow-auto custom-scroll relative select-none">
                <div className="min-w-[800px] flex">

                    {/* Time Labels Column */}
                    <div className="w-[50px] shrink-0 bg-gray-50 border-r sticky left-0 z-30">
                        <div className="h-10 border-b bg-gray-50"></div> {/* Header spacer */}
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

                            // Calculate Layout for this day
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

                                    {/* Grid Lines */}
                                    <div className="relative">
                                        {timeSlots.map(time => (
                                            <div key={time} className="h-12 border-b"></div>
                                        ))}

                                        {/* Events Overlay */}
                                        {positionedBookings.map(booking => {
                                            const isInteracting = interaction && interaction.bookingId === booking.ids[0];
                                            if (isInteracting) return null; // Don't render original if interacting

                                            const canInteract = !!onUpdate;

                                            return (
                                                <div
                                                    key={booking.ids[0]}
                                                    className={`absolute bg-blue-100 border border-blue-300 rounded p-1 text-xs overflow-hidden transition-shadow group ${canInteract ? 'hover:z-10 hover:shadow-md cursor-pointer' : ''}`}
                                                    style={getEventStyle(booking)}
                                                    onMouseDown={(e) => canInteract && handleMouseDown(e, booking, 'move')}
                                                >
                                                    {/* Top Handle */}
                                                    {canInteract && (
                                                        <div
                                                            className="absolute top-0 left-0 right-0 h-2 cursor-ns-resize opacity-0 group-hover:opacity-100 bg-blue-400/20"
                                                            onMouseDown={(e) => handleMouseDown(e, booking, 'resize-top')}
                                                        ></div>
                                                    )}

                                                    <div className="font-bold text-blue-900 truncate pointer-events-none">{booking.tool_name}</div>
                                                    <div className="text-blue-700 truncate text-[10px] pointer-events-none">{booking.project}</div>
                                                    <div className="text-blue-600 text-[10px] pointer-events-none">{booking.startTime} - {booking.endTime}</div>

                                                    {/* Bottom Handle */}
                                                    {canInteract && (
                                                        <div
                                                            className="absolute bottom-0 left-0 right-0 h-2 cursor-ns-resize opacity-0 group-hover:opacity-100 bg-blue-400/20"
                                                            onMouseDown={(e) => handleMouseDown(e, booking, 'resize-bottom')}
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
                                                <div className="font-bold text-blue-900 truncate">{interactingBooking.tool_name}</div>
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
        </div>
    );
};

export default UserBookingsCalendar;
