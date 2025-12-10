import React, { useState, useMemo, useEffect, useRef } from 'react';
import StatusBadge from './StatusBadge';
import { useToast } from '../context/ToastContext';
import { getNextSlotTime, groupBookings, checkCollision, calculateEventLayout } from '../utils/bookingUtils';
import { useBookingInteraction } from '../hooks/useBookingInteraction';

const BookingModal = ({ tool, user, profile, onClose, onConfirm, onUpdate, onCancel, existingBookings = [], initialDate, isAdminOverride = false }) => {
    // Initialize week start to current week's Monday
    const [currentWeekStart, setCurrentWeekStart] = useState(() => {
        const d = initialDate ? new Date(initialDate) : new Date();
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday
        const newDate = new Date(d);
        newDate.setDate(diff);
        return newDate;
    });

    const [selectedSlots, setSelectedSlots] = useState([]); // Array of {date, time}
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [editingBooking, setEditingBooking] = useState(null); // Booking being edited locally
    const [selectedProject, setSelectedProject] = useState('General'); // Default to General

    // Selection State (for creating new bookings)
    const [isSelecting, setIsSelecting] = useState(false);
    const selectionRef = useRef(null); // { startDIndex, startTIndex, currentDIndex, currentTIndex }
    const longPressTimer = useRef(null);

    const { showToast } = useToast();

    // Validation
    const isAdmin = profile?.access_level === 'admin';
    const hasLicense = Array.isArray(profile?.licenses) ? profile.licenses.includes(tool.id) : false;
    const isToolUp = tool.status === 'up';
    const canBook = isAdmin || (hasLicense && isToolUp) || isAdminOverride;

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
        for (let h = 0; h < 24; h++) {
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

        // Calculate the start of the current half-hour slot
        const currentSlotStart = new Date(now);
        const currentMinutes = now.getMinutes();
        const roundedMinutes = currentMinutes < 30 ? 0 : 30;
        currentSlotStart.setMinutes(roundedMinutes, 0, 0);

        return slotDate < currentSlotStart;
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
    // If we are editing, we want to show the edited version instead of the original
    const displayBookings = useMemo(() => {
        if (!editingBooking) return existingBookings;

        // Get all IDs associated with the booking being edited
        const editIds = editingBooking.ids || [editingBooking.id];
        const primaryId = editIds[0];

        if (!primaryId) return existingBookings;

        const updated = existingBookings.map(b => {
            // If it's the primary ID, replace with edited version
            if (b.id === primaryId) {
                // console.log('Replacing primary ID', primaryId, 'with', editingBooking);
                return editingBooking;
            }
            // If it's one of the other IDs in the group, hide it (return null and filter)
            if (editIds.includes(b.id)) return null;
            return b;
        }).filter(Boolean);

        return updated;
    }, [existingBookings, editingBooking]);

    const groupedBookings = useMemo(() => {
        // Filter for this tool only
        const toolBookings = displayBookings.filter(b => b.tool_id === tool.id);
        return groupBookings(toolBookings);
    }, [displayBookings, tool.id]);

    // Use the new hook
    const { interaction, startInteraction } = useBookingInteraction({
        weekDates,
        existingBookings: displayBookings, // Use displayBookings to avoid colliding with hidden ghosts
        user,
        isAdmin,
        isAdminOverride,
        onInteractionEnd: (newBooking) => {
            console.log('onInteractionEnd called with:', newBooking);
            setEditingBooking(newBooking);
        },
        showToast
    });

    const PIXELS_PER_30_MINS = 48;
    const START_HOUR = 0;

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

    const handleBookingClick = (e, booking) => {
        e.stopPropagation();
        // If interaction is active (dragging), don't open popup
        if (interaction) {
            console.log('handleBookingClick blocked by interaction');
            return;
        }

        console.log('handleBookingClick fired', booking);

        // Permission check
        const isOwnBooking = booking.user_id === user.id;
        if (!isAdmin && !isOwnBooking) return;

        // Start editing mode
        // We need to ensure we have a single ID to track
        const bookingId = booking.ids[0];
        const singleBooking = {
            ...booking,
            id: bookingId,
            // Ensure we have flat structure if needed, but 'booking' from groupBookings is already good
        };

        setEditingBooking(singleBooking);
        setSelectedProject(booking.project);
        setSelectedSlots([]); // Clear selection
    };

    const handleCancelEdit = () => {
        setEditingBooking(null);
    };

    const handleCancelClick = (e, booking) => {
        e.stopPropagation();
        if (onCancel && booking && booking.ids) {
            onCancel(booking.ids);
            setEditingBooking(null); // Deselect after cancelling
        }
    };

    // --- Selection Handlers (Create New) ---

    const handleGridMouseDown = (dateStr, timeIndex) => {
        setEditingBooking(null);
        if (!canBook) return;

        // Don't start selection if clicking on an existing booking (handled by stopPropagation, but safety check)
        const timeStr = timeSlots[timeIndex];
        if (isSlotBooked(dateStr, timeStr)) return;
        if (isSlotInPast(dateStr, timeStr) && !isAdminOverride) {
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
                if (!isSlotBooked(dStr, tStr) && (isAdminOverride || !isSlotInPast(dStr, tStr))) {
                    newSlots.push({ date: dStr, time: tStr });
                }
            }
        }

        setSelectedSlots(newSlots);
    };

    // --- Touch Handlers (Mobile Drag-to-Select & Long Press) ---

    // Effect to handle touch moves when selecting (prevents scrolling)
    useEffect(() => {
        if (!isSelecting) return;

        const handleWindowTouchMove = (e) => {
            // Prevent scrolling
            if (e.cancelable) e.preventDefault();

            const touch = e.touches[0];
            const element = document.elementFromPoint(touch.clientX, touch.clientY);

            if (element && element.dataset.date && element.dataset.timeindex) {
                const dateStr = element.dataset.date;
                const timeIndex = parseInt(element.dataset.timeindex, 10);

                const dIndex = weekDates.findIndex(d => formatDate(d) === dateStr);

                if (dIndex !== -1 && selectionRef.current) {
                    if (dIndex !== selectionRef.current.currentDIndex || timeIndex !== selectionRef.current.currentTIndex) {
                        selectionRef.current.currentDIndex = dIndex;
                        selectionRef.current.currentTIndex = timeIndex;
                        updateSelectedSlots(selectionRef.current);
                    }
                }
            }
        };

        const handleSelectionEnd = () => {
            setIsSelecting(false);
            selectionRef.current = null;
        };

        // Add non-passive listener to allow preventing default
        window.addEventListener('touchmove', handleWindowTouchMove, { passive: false });
        window.addEventListener('touchend', handleSelectionEnd);
        window.addEventListener('mouseup', handleSelectionEnd);

        return () => {
            window.removeEventListener('touchmove', handleWindowTouchMove);
            window.removeEventListener('touchend', handleSelectionEnd);
            window.removeEventListener('mouseup', handleSelectionEnd);
        };
    }, [isSelecting, weekDates]);

    // Grid Touch Handlers
    const handleGridTouchStart = (e, dateStr, timeIndex) => {
        e.persist();

        longPressTimer.current = setTimeout(() => {
            setEditingBooking(null);
            if (!canBook) return;

            const timeStr = timeSlots[timeIndex];
            if (isSlotBooked(dateStr, timeStr)) return;
            if (isSlotInPast(dateStr, timeStr) && !isAdminOverride) {
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

            if (navigator.vibrate) navigator.vibrate(50);

        }, 500);
    };

    const handleGridTouchMove = (e) => {
        // Only used to cancel the timer if we scroll before selection starts
        if (!isSelecting && longPressTimer.current) {
            clearTimeout(longPressTimer.current);
            longPressTimer.current = null;
        }
    };

    const handleGridTouchEnd = () => {
        if (longPressTimer.current) {
            clearTimeout(longPressTimer.current);
            longPressTimer.current = null;
        }
    };



    // --- Touch Handlers (Mobile Drag-to-Select & Long Press) ---

    // Effect to handle touch moves when selecting (prevents scrolling)
    useEffect(() => {
        if (!isSelecting) return;

        const handleWindowTouchMove = (e) => {
            // Prevent scrolling
            if (e.cancelable) e.preventDefault();

            const touch = e.touches[0];
            const element = document.elementFromPoint(touch.clientX, touch.clientY);

            if (element && element.dataset.date && element.dataset.timeindex) {
                const dateStr = element.dataset.date;
                const timeIndex = parseInt(element.dataset.timeindex, 10);

                const dIndex = weekDates.findIndex(d => formatDate(d) === dateStr);

                if (dIndex !== -1 && selectionRef.current) {
                    if (dIndex !== selectionRef.current.currentDIndex || timeIndex !== selectionRef.current.currentTIndex) {
                        selectionRef.current.currentDIndex = dIndex;
                        selectionRef.current.currentTIndex = timeIndex;
                        updateSelectedSlots(selectionRef.current);
                    }
                }
            }
        };

        const handleWindowTouchEnd = () => {
            setIsSelecting(false);
            selectionRef.current = null;
        };

        // Add non-passive listener to allow preventing default
        window.addEventListener('touchmove', handleWindowTouchMove, { passive: false });
        window.addEventListener('touchend', handleWindowTouchEnd);

        return () => {
            window.removeEventListener('touchmove', handleWindowTouchMove);
            window.removeEventListener('touchend', handleWindowTouchEnd);
        };
    }, [isSelecting, weekDates]);



    // Booking Touch Handlers
    const touchStartRef = useRef(null);

    const handleBookingTouchStart = (e, booking, type) => {
        e.stopPropagation();

        const target = e.currentTarget;
        const touch = e.touches[0];
        const clientX = touch.clientX;
        const clientY = touch.clientY;

        touchStartRef.current = { x: clientX, y: clientY };

        longPressTimer.current = setTimeout(() => {
            const isOwnBooking = booking.user_id === user.id;
            if (!isAdmin && !isOwnBooking) return;

            const syntheticEvent = {
                stopPropagation: () => { },
                currentTarget: target,
                type: 'touchstart',
                touches: [{ clientX, clientY }]
            };

            startInteraction(syntheticEvent, booking, type);
            longPressTimer.current = null; // Mark as fired

            if (navigator.vibrate) navigator.vibrate(50);
        }, 500);
    };

    const handleBookingTouchMove = (e) => {
        if (longPressTimer.current && touchStartRef.current) {
            // If the event is not cancelable, the browser has already claimed it for scrolling
            if (!e.cancelable) {
                clearTimeout(longPressTimer.current);
                longPressTimer.current = null;
                touchStartRef.current = null;
                return;
            }

            const touch = e.touches[0];
            const moveX = touch.clientX;
            const moveY = touch.clientY;
            const diffX = Math.abs(moveX - touchStartRef.current.x);
            const diffY = Math.abs(moveY - touchStartRef.current.y);

            // Only cancel if moved more than 5px (reduced from 10px to prevent scroll conflict)
            if (diffX > 5 || diffY > 5) {
                clearTimeout(longPressTimer.current);
                longPressTimer.current = null;
                touchStartRef.current = null;
            }
        }
    };

    const handleBookingTouchEnd = () => {
        if (longPressTimer.current) {
            clearTimeout(longPressTimer.current);
            longPressTimer.current = null;
        }
        touchStartRef.current = null;
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

    const handleConfirmBooking = async () => {
        if (editingBooking) {
            setIsSubmitting(true);
            const oldIds = editingBooking.ids || [editingBooking.id];
            const updateData = {
                ...editingBooking,
                project: selectedProject
            };

            await onUpdate(oldIds, updateData);
            setIsSubmitting(false);
            setEditingBooking(null);
            return;
        }

        if (selectedSlots.length === 0) {
            showToast('Please select at least one time slot.', 'error');
            return;
        }

        setIsSubmitting(true);
        const now = new Date().toISOString();

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
            project: selectedProject,
            date: range.date,
            time: range.startTime,
            end_time: range.endTime,
            created_at: now
        }));

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
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-sm">
            <div
                className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl w-full max-w-5xl h-[90vh] flex flex-col overflow-hidden m-4 transition-colors border dark:border-gray-700"
                onClick={() => setEditingBooking(null)}
            >
                {/* Header */}
                <div className="bg-blue-900 dark:bg-blue-950 text-white p-4 flex justify-between items-center shrink-0 transition-colors">
                    <h2 className="text-xl font-bold"><i className="fas fa-calendar-alt mr-2"></i>Weekly Schedule</h2>
                    <button onClick={onClose} className="hover:text-gray-300 transition-colors"><i className="fas fa-times text-xl"></i></button>
                </div>

                {/* Tool Info & Controls */}
                <div className="p-4 border-b dark:border-gray-700 bg-gray-50 dark:bg-gray-900 flex flex-col sm:flex-row justify-between items-center shrink-0 gap-4 sm:gap-0 transition-colors">
                    <div className="text-center sm:text-left">
                        <h3 className="font-bold text-lg text-gray-800 dark:text-gray-200 transition-colors">{tool.name}</h3>
                        <div className="flex gap-2 text-sm mt-1 justify-center sm:justify-start">
                            <StatusBadge status={tool.status} />
                            {hasLicense ?
                                <span className="text-green-700 bg-green-100 px-2 rounded font-bold">Licensed</span> :
                                <span className="text-red-700 bg-red-100 px-2 rounded font-bold">No License</span>
                            }
                        </div>
                    </div>
                    <div className="flex items-center gap-2 sm:gap-4 w-full sm:w-auto justify-between sm:justify-end">
                        <button onClick={handlePrevWeek} className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 rounded transition-colors"><i className="fas fa-chevron-left"></i></button>
                        <div className="font-bold text-gray-700 dark:text-gray-300 w-full sm:w-48 text-center text-sm sm:text-base transition-colors">
                            {weekDates[0].toLocaleDateString()} - {weekDates[6].toLocaleDateString()}
                        </div>
                        <button onClick={handleNextWeek} className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 rounded transition-colors"><i className="fas fa-chevron-right"></i></button>
                    </div>
                </div>

                {!canBook && (
                    <div className="bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-800 p-2 text-center text-red-700 dark:text-red-400 text-sm font-bold shrink-0 transition-colors">
                        {!isToolUp ? "Tool is currently down for maintenance." : "You do not have a license for this tool."}
                    </div>
                )}

                {/* Calendar Grid Container */}
                <div className="flex-1 overflow-auto custom-scroll relative select-none">
                    <div className="min-w-[800px] flex">

                        {/* Time Labels Column */}
                        <div className="w-[50px] shrink-0 bg-gray-50 dark:bg-gray-900 border-r dark:border-gray-700 sticky left-0 z-30 transition-colors">
                            <div className="h-10 border-b dark:border-gray-700 bg-gray-50 dark:bg-gray-900 transition-colors"></div>
                            {timeSlots.map(time => (
                                <div key={time} className="h-12 border-b dark:border-gray-700 text-right pr-2 text-xs text-gray-500 dark:text-gray-400 font-mono flex items-center justify-end transition-colors">
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
                                    <div key={i} className="flex-1 min-w-[100px] border-r dark:border-gray-700 last:border-0 relative transition-colors">
                                        {/* Day Header */}
                                        <div className="h-10 border-b dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-center font-semibold text-gray-700 dark:text-gray-300 text-sm flex items-center justify-center sticky top-0 z-20 transition-colors">
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
                                                        data-date={dateStr}
                                                        data-timeindex={tIndex}
                                                        className={`h-12 border-b dark:border-gray-700 ${isSelected ? 'bg-blue-200 dark:bg-blue-800' : ''} ${isPast ? 'bg-gray-200 dark:bg-black/40 cursor-not-allowed' : ''} transition-colors`}
                                                        onMouseDown={() => handleGridMouseDown(dateStr, tIndex)}
                                                        onMouseEnter={() => handleMouseEnter(dateStr, tIndex)}
                                                        onTouchStart={(e) => handleGridTouchStart(e, dateStr, tIndex)}
                                                        onTouchMove={handleGridTouchMove}
                                                        onTouchEnd={handleGridTouchEnd}
                                                    ></div>
                                                );
                                            })}

                                            {/* Existing Bookings Overlay */}
                                            {positionedBookings.map(booking => {
                                                const isInteracting = interaction && interaction.bookingId === booking.ids[0];
                                                if (isInteracting) return null;

                                                const isOwnBooking = booking.user_id === user.id;
                                                const canEdit = isAdmin || isOwnBooking;

                                                const now = new Date();
                                                const bookingStart = new Date(`${booking.date}T${booking.startTime}`);
                                                const isStarted = bookingStart <= now;

                                                // Disable moving/resizing start if booking has already started
                                                const canMove = canEdit && (!isStarted || isAdminOverride);
                                                const canResizeTop = canEdit && (!isStarted || isAdminOverride);
                                                const canResizeBottom = canEdit; // Always allow extending/shortening end time

                                                return (
                                                    <div
                                                        key={booking.ids[0]}
                                                        className={`absolute border rounded p-1 text-xs overflow-hidden transition-all group 
                                                            ${isOwnBooking ? 'bg-blue-100 dark:bg-blue-900/60 border-blue-300 dark:border-blue-700' : 'bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600'}
                                                            ${canEdit ? 'hover:z-10 hover:shadow-md cursor-pointer' : ''}
                                                            ${editingBooking && editingBooking.id === booking.ids[0] ? 'ring-2 ring-blue-500 z-20' : ''}
                                                            `}
                                                        style={getEventStyle(booking)}
                                                        onMouseDown={(e) => canMove && startInteraction(e, booking, 'move')}
                                                        onTouchStart={(e) => canMove && handleBookingTouchStart(e, booking, 'move')}
                                                        onTouchMove={handleBookingTouchMove}
                                                        onTouchEnd={handleBookingTouchEnd}
                                                        onClick={(e) => handleBookingClick(e, booking)}
                                                        title={`Booked by: ${booking.user_name}\nProject: ${booking.project}`}
                                                    >
                                                        {canResizeTop && (
                                                            <div
                                                                className="absolute top-0 left-0 right-0 h-3 z-20 cursor-ns-resize opacity-0 group-hover:opacity-100 bg-blue-400/20"
                                                                onMouseDown={(e) => { e.stopPropagation(); startInteraction(e, booking, 'resize-top'); }}
                                                                onTouchStart={(e) => { e.stopPropagation(); handleBookingTouchStart(e, booking, 'resize-top'); }}
                                                                onTouchMove={handleBookingTouchMove}
                                                                onTouchEnd={handleBookingTouchEnd}
                                                            ></div>
                                                        )}

                                                        <div className={`font-bold truncate pointer-events-none ${isOwnBooking ? 'text-blue-900 dark:text-blue-100' : 'text-gray-800 dark:text-gray-200'}`}>{booking.user_name}</div>

                                                        <div className={`truncate text-[10px] pointer-events-none ${isOwnBooking ? 'text-blue-700 dark:text-blue-300' : 'text-gray-600 dark:text-gray-400'}`}>{booking.project}</div>

                                                        {editingBooking && editingBooking.id === booking.ids[0] && (isAdmin || isOwnBooking) && (!isStarted || isAdminOverride) && (
                                                            <div
                                                                className="absolute top-0 right-0 p-1 cursor-pointer text-red-600 hover:text-red-800 bg-white/50 hover:bg-white rounded-bl z-30"
                                                                onClick={(e) => handleCancelClick(e, booking)}
                                                                title="Cancel Booking"
                                                            >
                                                                <i className="fas fa-times text-xs"></i>
                                                            </div>
                                                        )}

                                                        {canEdit && (
                                                            <div
                                                                className="absolute bottom-0 left-0 right-0 h-3 z-20 cursor-ns-resize opacity-0 group-hover:opacity-100 bg-blue-400/20"
                                                                onMouseDown={(e) => { e.stopPropagation(); startInteraction(e, booking, 'resize-bottom'); }}
                                                                onTouchStart={(e) => { e.stopPropagation(); handleBookingTouchStart(e, booking, 'resize-bottom'); }}
                                                                onTouchMove={handleBookingTouchMove}
                                                                onTouchEnd={handleBookingTouchEnd}
                                                            ></div>
                                                        )}
                                                    </div>
                                                );
                                            })}

                                            {/* Interaction Ghost */}
                                            {isTargetDay && (
                                                <div
                                                    className={`absolute border border-dashed rounded p-1 text-xs overflow-hidden z-50 opacity-80 pointer-events-none
                                                        ${interaction.isValid
                                                            ? 'bg-blue-200 border-blue-500'
                                                            : 'bg-red-200 border-red-500'
                                                        }`}
                                                    style={{
                                                        top: `${interaction.currentTop}px`,
                                                        height: `${interaction.currentHeight - 1}px`,
                                                        left: '2px',
                                                        right: '2px'
                                                    }}
                                                >
                                                    <div className={`font-bold truncate ${interaction.isValid ? 'text-blue-900' : 'text-red-900'}`}>
                                                        {interactingBooking.user_name}
                                                    </div>
                                                    <div className={`truncate text-[10px] ${interaction.isValid ? 'text-blue-700' : 'text-red-700'}`}>
                                                        {interactingBooking.project}
                                                    </div>
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
                <div className="p-4 border-t dark:border-gray-700 bg-white dark:bg-gray-800 flex flex-col-reverse sm:flex-row justify-end gap-3 shrink-0 z-30 transition-colors">
                    <div className="mr-auto flex flex-wrap items-center gap-4 text-sm mb-2 sm:mb-0 text-gray-600 dark:text-gray-400">
                        <div className="flex items-center gap-1"><div className="w-4 h-4 bg-white dark:bg-gray-800 border dark:border-gray-600"></div> Available</div>
                        <div className="flex items-center gap-1"><div className="w-4 h-4 bg-blue-200 dark:bg-blue-800 rounded"></div> Selected</div>
                        <div className="flex items-center gap-1"><div className="w-4 h-4 bg-blue-100 dark:bg-blue-900/60 border border-blue-300 dark:border-blue-700 rounded"></div> My Booking</div>
                        <div className="flex items-center gap-1"><div className="w-4 h-4 bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded"></div> Other's Booking</div>
                    </div>

                    <div className="flex items-center gap-2">
                        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Project:</label>
                        <select
                            value={selectedProject}
                            onChange={(e) => setSelectedProject(e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                            className="border dark:border-gray-600 rounded p-1 text-sm focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-800 dark:text-white"
                        >
                            <option value="General">General</option>
                            {profile?.projects?.map((proj, idx) => (
                                <option key={idx} value={proj}>{proj}</option>
                            ))}
                        </select>
                    </div>

                    <button onClick={editingBooking ? handleCancelEdit : onClose} className="px-4 py-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors">Cancel</button>
                    <button
                        disabled={(selectedSlots.length === 0 && !editingBooking) || isSubmitting}
                        onClick={(e) => { e.stopPropagation(); handleConfirmBooking(); }}
                        className={`px-6 py-2 rounded text-white font-bold transition flex items-center gap-2 ${(selectedSlots.length === 0 && !editingBooking) || isSubmitting ? 'bg-gray-300 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'}`}
                    >
                        {isSubmitting && <i className="fas fa-spinner fa-spin"></i>}
                        {isSubmitting ? (editingBooking ? 'Updating...' : 'Booking...') : (editingBooking ? 'Update Booking' : 'Confirm Booking')}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default BookingModal;
