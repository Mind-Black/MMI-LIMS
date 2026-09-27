import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import StatusBadge from './StatusBadge';
import { useToast } from '../context/useToast';
import {
    getNextSlotTime,
    groupBookings,
    checkCollision,
    calculateEventLayout,
    checkBookingEligibility,
    formatLocalDate,
    formatDisplayDate,
    getMonday,
    addDays,
    getVilniusNow,
    getVilniusCurrentMinutes,
    isVilniusToday,
    isBookingStarted,
    isSlotInPast
} from '../utils/bookingUtils';
import { useBookingInteraction } from '../hooks/useBookingInteraction';
import { supabase } from '../supabaseClient';

const BookingModal = ({
    tool,
    user,
    profile,
    onClose,
    onConfirm,
    onUpdate,
    onCancel,
    existingBookings = [],
    initialDate,
    initialBooking = null,
    isAdminOverride = false
}) => {
    // Initialize week start to current week's Monday in lab timezone (Fixes R6)
    const [currentWeekStart, setCurrentWeekStart] = useState(() => {
        return getMonday(initialDate || getVilniusNow().dateStr);
    });

    const [toolWeekBookings, setToolWeekBookings] = useState([]);
    const [selectedSlots, setSelectedSlots] = useState([]);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const [editingBooking, setEditingBooking] = useState(initialBooking || null);
    const [originalBookingState, setOriginalBookingState] = useState(initialBooking || null);
    const [selectedProject, setSelectedProject] = useState(initialBooking ? initialBooking.project : 'General');

    const scrollContainerRef = useRef(null);

    // Selection State
    const [isSelecting, setIsSelecting] = useState(false);
    const selectionRef = useRef(null);
    const longPressTimer = useRef(null);

    const [currentTime, setCurrentTime] = useState(new Date());

    useEffect(() => {
        const timer = setInterval(() => setCurrentTime(new Date()), 30000);
        return () => clearInterval(timer);
    }, []);

    const vilniusNow = useMemo(() => getVilniusNow(currentTime), [currentTime]);

    // Message Modal State
    const [isMessageModalOpen, setIsMessageModalOpen] = useState(false);
    const [messageSubject, setMessageSubject] = useState('');
    const [messageBody, setMessageBody] = useState('');
    const [isSendingMessage, setIsSendingMessage] = useState(false);

    const { showToast } = useToast();

    const handleSendMessage = async () => {
        if (!messageSubject.trim() || !messageBody.trim()) {
            showToast('Please enter both subject and message.', 'error');
            return;
        }

        if (isSendingMessage) return;

        setIsSendingMessage(true);
        try {
            if (!editingBooking) {
                showToast('Error: No booking selected.', 'error');
                return;
            }

            // Send message authoritatively through backend Edge Function (S4)
            const { data, error } = await supabase.functions.invoke('send-email', {
                body: {
                    bookingId: editingBooking.id,
                    subject: messageSubject.trim(),
                    message: messageBody.trim()
                }
            });

            if (error || data?.error) {
                throw new Error(error?.message || data?.error || 'Failed to send message');
            }

            showToast('Message sent successfully.', 'success');
            setIsMessageModalOpen(false);
            setMessageSubject('');
            setMessageBody('');
        } catch (error) {
            console.error('Error sending message:', error);
            showToast('Failed to send message: ' + error.message, 'error');
        } finally {
            setIsSendingMessage(false);
        }
    };

    // Centralized Eligibility check (L4)
    const isAdmin = profile?.access_level === 'admin';
    const eligibility = checkBookingEligibility(tool, profile, isAdminOverride);
    const canBook = eligibility.canBook;

    // Helper to get dates for the week (Fixes R6)
    const weekDates = useMemo(() => {
        const dates = [];
        for (let i = 0; i < 7; i++) {
            dates.push(addDays(currentWeekStart, i));
        }
        return dates;
    }, [currentWeekStart]);

    const weekStartStr = useMemo(() => formatLocalDate(currentWeekStart), [currentWeekStart]);
    const weekEndStr = useMemo(() => formatLocalDate(addDays(currentWeekStart, 6)), [currentWeekStart]);

    // Fetch tool availability for the active week window in modal (Fixes R5)
    const fetchToolWeekBookings = useCallback(async () => {
        if (!tool?.id) return;
        try {
            const { data, error } = await supabase
                .from('bookings')
                .select('id, tool_id, tool_name, user_id, user_name, project, date, time, end_time, starts_at, ends_at, created_at')
                .eq('tool_id', tool.id)
                .gte('date', weekStartStr)
                .lte('date', weekEndStr)
                .order('date', { ascending: true })
                .order('time', { ascending: true });

            if (!error && data) {
                setToolWeekBookings(data);
            }
        } catch (err) {
            console.error('Error fetching tool week bookings:', err);
        }
    }, [tool?.id, weekStartStr, weekEndStr]);

    useEffect(() => {
        fetchToolWeekBookings();
    }, [fetchToolWeekBookings]);

    // Helper to generate 30-min slots from 00:00 to 24:00
    const timeSlots = useMemo(() => {
        const slots = [];
        for (let h = 0; h < 24; h++) {
            const hStr = h < 10 ? '0' + h : h;
            slots.push(`${hStr}:00`);
            slots.push(`${hStr}:30`);
        }
        return slots;
    }, []);

    const PIXELS_PER_30_MINS = 48;
    const START_HOUR = 0;

    // Scroll to booking or 9 AM on mount
    useEffect(() => {
        if (scrollContainerRef.current) {
            let targetHour = 9;
            let targetMin = 0;

            if (initialBooking) {
                const timeStr = initialBooking.time || initialBooking.startTime;
                if (timeStr) {
                    const [h, m] = timeStr.split(':').map(Number);
                    targetHour = h;
                    targetMin = m;
                }
            }

            const hoursFromStart = targetHour - START_HOUR;
            const slotsFromStart = (hoursFromStart * 2) + (targetMin / 30);
            scrollContainerRef.current.scrollTop = slotsFromStart * PIXELS_PER_30_MINS;
        }
    }, [initialBooking]);

    const formatDate = (date) => formatLocalDate(date);
    const displayDate = (date) => formatDisplayDate(date);

    const getMinutes = (timeStr) => {
        const [h, m] = timeStr.split(':').map(Number);
        return (h * 60) + m;
    };

    const allKnownBookings = useMemo(() => {
        const map = new Map();
        for (const b of existingBookings) {
            map.set(b.id, b);
        }
        for (const b of toolWeekBookings) {
            map.set(b.id, b);
        }
        return Array.from(map.values());
    }, [existingBookings, toolWeekBookings]);

    const isSlotBooked = useCallback((dateStr, timeStr) => {
        const slotStart = getMinutes(timeStr);
        const slotEnd = slotStart + 30;

        return allKnownBookings.some(b => {
            if (b.date !== dateStr || (b.tool_id !== tool.id && b.toolId !== tool.id)) return false;

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
    }, [allKnownBookings, tool.id]);

    const getCurrentTimeTop = () => {
        const totalMinutes = getVilniusCurrentMinutes(currentTime);
        return (totalMinutes / 30) * PIXELS_PER_30_MINS;
    };

    const isToday = (date) => isVilniusToday(date, currentTime);

    // Group bookings for display
    const displayBookings = useMemo(() => {
        if (!editingBooking) return allKnownBookings;

        const editIds = editingBooking.ids || [editingBooking.id];
        const primaryId = editIds[0];

        if (!primaryId) return allKnownBookings;

        return allKnownBookings.map(b => {
            if (b.id === primaryId) {
                return editingBooking;
            }
            if (editIds.includes(b.id)) return null;
            return b;
        }).filter(Boolean);
    }, [allKnownBookings, editingBooking]);

    const groupedBookings = useMemo(() => {
        const toolBookings = displayBookings.filter(b => b.tool_id === tool.id);
        return groupBookings(toolBookings);
    }, [displayBookings, tool.id]);

    const { interaction, startInteraction } = useBookingInteraction({
        weekDates,
        existingBookings: displayBookings,
        user,
        isAdmin,
        isAdminOverride,
        onInteractionEnd: (newBooking) => {
            setEditingBooking(newBooking);
        },
        showToast
    });

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
        if (interaction) return;

        const bookingId = booking.ids[0];
        const singleBooking = {
            ...booking,
            id: bookingId,
        };

        setEditingBooking(singleBooking);
        setOriginalBookingState(singleBooking);
        setSelectedProject(booking.project);
        setSelectedSlots([]);
    };

    const handleCancelClick = (e, booking) => {
        e.stopPropagation();
        if (onCancel && booking && booking.ids) {
            onCancel(booking.ids, (cancelledIds) => {
                const idsToRemove = Array.isArray(cancelledIds) ? cancelledIds : booking.ids;
                setToolWeekBookings(prev => prev.filter(b => !idsToRemove.includes(b.id)));
                setEditingBooking(null);
                setOriginalBookingState(null);
                setSelectedSlots([]);
                fetchToolWeekBookings();
            });
            setEditingBooking(null);
        }
    };

    const updateSelectedSlots = useCallback((sel) => {
        const minD = Math.min(sel.startDIndex, sel.currentDIndex);
        const maxD = Math.max(sel.startDIndex, sel.currentDIndex);
        const minT = Math.min(sel.startTIndex, sel.currentTIndex);
        const maxT = Math.max(sel.startTIndex, sel.currentTIndex);

        const newSlots = [];
        for (let d = minD; d <= maxD; d++) {
            for (let t = minT; t <= maxT; t++) {
                const dStr = formatLocalDate(weekDates[d]);
                const tStr = timeSlots[t];
                if (!isSlotBooked(dStr, tStr) && (isAdminOverride || !isSlotInPast(dStr, tStr))) {
                    newSlots.push({ date: dStr, time: tStr });
                }
            }
        }

        setSelectedSlots(newSlots);
    }, [weekDates, timeSlots, isAdminOverride, isSlotBooked]);

    const handleGridMouseDown = (dateStr, timeIndex) => {
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
    };

    const handleMouseEnter = (dateStr, timeIndex) => {
        if (isSelecting && selectionRef.current) {
            const dIndex = weekDates.findIndex(d => formatDate(d) === dateStr);

            selectionRef.current.currentDIndex = dIndex;
            selectionRef.current.currentTIndex = timeIndex;

            updateSelectedSlots(selectionRef.current);
        }
    };

    // Touch selection handling
    useEffect(() => {
        if (!isSelecting) return;

        const handleWindowTouchMove = (e) => {
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

        window.addEventListener('touchmove', handleWindowTouchMove, { passive: false });
        window.addEventListener('touchend', handleSelectionEnd);
        window.addEventListener('mouseup', handleSelectionEnd);

        return () => {
            window.removeEventListener('touchmove', handleWindowTouchMove);
            window.removeEventListener('touchend', handleSelectionEnd);
            window.removeEventListener('mouseup', handleSelectionEnd);
        };
    }, [isSelecting, weekDates, updateSelectedSlots]);

    const handleGridTouchStart = (e, dateStr, timeIndex) => {
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
        }, 500);
    };

    const handleGridTouchEnd = () => {
        if (longPressTimer.current) {
            clearTimeout(longPressTimer.current);
        }
    };

    const handleBookingTouchStart = (e, booking, type) => {
        longPressTimer.current = setTimeout(() => {
            startInteraction(e, booking, type);
        }, 400);
    };

    const handleBookingTouchMove = () => {
        if (longPressTimer.current && !interaction) {
            clearTimeout(longPressTimer.current);
        }
    };

    const handleBookingTouchEnd = () => {
        if (longPressTimer.current) {
            clearTimeout(longPressTimer.current);
        }
    };

    // Week navigation (Fixes R11, R6)
    const handlePrevWeek = () => {
        setSelectedSlots([]);
        setCurrentWeekStart(prev => addDays(prev, -7));
    };

    const handleNextWeek = () => {
        setSelectedSlots([]);
        setCurrentWeekStart(prev => addDays(prev, 7));
    };

    const handleToday = () => {
        setSelectedSlots([]);
        setCurrentWeekStart(getMonday(getVilniusNow(currentTime).dateStr));
    };

    // Mutation with draft preservation (L5)
    const handleConfirmBooking = async () => {
        if (editingBooking) {
            setIsSubmitting(true);
            try {
                const oldIds = editingBooking.ids || [editingBooking.id];
                const updateData = {
                    ...editingBooking,
                    project: selectedProject
                };

                const result = await onUpdate(oldIds, updateData);
                if (result?.success) {
                    setEditingBooking(null);
                    setOriginalBookingState(null);
                    fetchToolWeekBookings();
                }
            } finally {
                setIsSubmitting(false);
            }
            return;
        }

        if (selectedSlots.length === 0) {
            showToast('Please select at least one time slot.', 'error');
            return;
        }

        setIsSubmitting(true);
        try {
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
                user_name: profile ? `${profile.first_name || ''} ${profile.last_name || ''}`.trim() : user.email,
                project: selectedProject,
                date: range.date,
                time: range.startTime,
                end_time: range.endTime,
                created_at: now
            }));

            const hasCollision = newBookings.some(newB => checkCollision(newB, existingBookings));
            if (hasCollision) {
                showToast('One or more selected slots are already booked.', 'error');
                return;
            }

            const result = await onConfirm(newBookings);
            if (result?.success) {
                setSelectedSlots([]);
            }
        } finally {
            setIsSubmitting(false);
        }
    };

    const isBookingDirty = useMemo(() => {
        if (!editingBooking || !originalBookingState) return false;
        return (
            editingBooking.date !== originalBookingState.date ||
            editingBooking.startTime !== originalBookingState.startTime ||
            editingBooking.endTime !== originalBookingState.endTime ||
            selectedProject !== originalBookingState.project
        );
    }, [editingBooking, originalBookingState, selectedProject]);

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-2 sm:p-4 backdrop-blur-sm animate-fade-in" onClick={onClose}>
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-7xl h-[95vh] flex flex-col overflow-hidden border dark:border-gray-700 transition-colors" onClick={(e) => e.stopPropagation()}>
                {/* Header */}
                <div className="p-4 border-b dark:border-gray-700 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white dark:bg-gray-800 shrink-0 z-30 transition-colors">
                    <div>
                        <div className="flex items-center gap-3">
                            <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100">{tool.name}</h2>
                            <StatusBadge status={tool.status} />
                            {!canBook && (
                                <span className="bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 text-xs px-2 py-0.5 rounded font-medium">
                                    {eligibility.reason || 'Booking Restricted'}
                                </span>
                            )}
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                            {tool.category} &bull; {tool.location} &bull; Lab Timezone: Europe/Vilnius (Current: {vilniusNow.timeStr})
                        </p>
                    </div>

                    <div className="flex items-center gap-2 self-stretch md:self-auto justify-between md:justify-end">
                        <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-700 p-1 rounded-lg">
                            <button onClick={handlePrevWeek} className="btn-icon text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-600" title="Previous Week">
                                <i className="fas fa-chevron-left text-xs"></i>
                            </button>
                            <button onClick={handleToday} className="px-2 py-1 text-xs font-semibold text-gray-700 dark:text-gray-200 hover:bg-white dark:hover:bg-gray-600 rounded">
                                Today
                            </button>
                            <button onClick={handleNextWeek} className="btn-icon text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-600" title="Next Week">
                                <i className="fas fa-chevron-right text-xs"></i>
                            </button>
                        </div>
                        <span className="text-sm font-semibold text-gray-700 dark:text-gray-200 mx-2 hidden sm:inline">
                            {displayDate(weekDates[0])} - {displayDate(weekDates[6])}
                        </span>
                        <button onClick={onClose} className="btn-icon text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                            <i className="fas fa-times text-lg"></i>
                        </button>
                    </div>
                </div>

                {/* Calendar Body */}
                <div ref={scrollContainerRef} className="flex-1 overflow-y-auto relative select-none flex flex-col bg-white dark:bg-gray-800 transition-colors">
                    <div className="sticky top-0 z-20 flex border-b dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm transition-colors">
                        <div className="w-16 shrink-0 border-r dark:border-gray-700 p-2 text-center text-xs font-bold text-gray-400">
                            Time
                        </div>
                        <div className="flex-1 grid grid-cols-7">
                            {weekDates.map((date, idx) => (
                                <div key={idx} className={`p-2 text-center border-r dark:border-gray-700 last:border-0 ${isToday(date) ? 'bg-blue-50/50 dark:bg-blue-900/20' : ''}`}>
                                    <div className="text-xs text-gray-500 dark:text-gray-400 uppercase font-semibold">
                                        {date.toLocaleDateString('en-US', { weekday: 'short' })}
                                    </div>
                                    <div className={`text-sm font-bold mt-0.5 ${isToday(date) ? 'text-blue-600 dark:text-blue-400' : 'text-gray-700 dark:text-gray-200'}`}>
                                        {date.getDate()}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="flex flex-1 relative min-h-[1152px]">
                        {/* Time labels */}
                        <div className="w-16 shrink-0 border-r dark:border-gray-700 bg-gray-50/50 dark:bg-gray-900/20 select-none">
                            {timeSlots.map((time, idx) => (
                                <div key={idx} className="h-12 border-b dark:border-gray-700/50 text-[10px] text-gray-400 text-right pr-2 pt-1 font-mono">
                                    {time.endsWith(':00') ? time : ''}
                                </div>
                            ))}
                        </div>

                        {/* Grid Columns */}
                        <div className="flex-1 grid grid-cols-7 relative">
                            {weekDates.map((date, dayIdx) => {
                                const dateStr = formatDate(date);
                                const dayBookings = groupedBookings.filter(b => b.date === dateStr);
                                const positionedBookings = calculateEventLayout(dayBookings);

                                const isTargetDay = interaction && interaction.currentDate === dateStr;
                                const interactingBooking = interaction ? interaction.originalBooking : null;

                                return (
                                    <div
                                        key={dayIdx}
                                        className={`border-r dark:border-gray-700 last:border-0 relative h-full ${isToday(date) ? 'bg-blue-50/10' : ''}`}
                                    >
                                        {/* Current Time Indicator on Today's Column */}
                                        {isToday(date) && (
                                            <div
                                                className="absolute left-0 right-0 border-t-2 border-red-500 z-20 pointer-events-none flex items-center"
                                                style={{ top: `${getCurrentTimeTop()}px` }}
                                                title={`Current Lab Time: ${vilniusNow.timeStr}`}
                                            >
                                                <div className="w-2.5 h-2.5 rounded-full bg-red-500 -ml-1.5 shadow-sm"></div>
                                            </div>
                                        )}
                                        <div className="absolute inset-0">
                                            {timeSlots.map((time, timeIdx) => {
                                                const isBooked = isSlotBooked(dateStr, time);
                                                const isPast = isSlotInPast(dateStr, time);
                                                const isSelected = selectedSlots.some(s => s.date === dateStr && s.time === time);

                                                return (
                                                    <div
                                                        key={timeIdx}
                                                        data-date={dateStr}
                                                        data-timeindex={timeIdx}
                                                        onMouseDown={() => handleGridMouseDown(dateStr, timeIdx)}
                                                        onMouseEnter={() => handleMouseEnter(dateStr, timeIdx)}
                                                        onTouchStart={(e) => handleGridTouchStart(e, dateStr, timeIdx)}
                                                        onTouchEnd={handleGridTouchEnd}
                                                        className={`h-12 border-b dark:border-gray-700/50 transition-colors cursor-pointer
                                                            ${time.endsWith(':00') ? 'border-b-gray-200 dark:border-b-gray-700' : 'border-b-gray-100 dark:border-b-gray-800/40'}
                                                            ${isBooked ? 'bg-stripes-gray cursor-not-allowed opacity-40' : ''}
                                                            ${isPast && !isAdminOverride ? 'bg-gray-50/80 dark:bg-gray-800/40 cursor-not-allowed text-gray-300' : 'hover:bg-blue-50/30 dark:hover:bg-blue-900/10'}
                                                            ${isSelected ? 'bg-blue-200 dark:bg-blue-800/80 !opacity-100' : ''}
                                                        `}
                                                    ></div>
                                                );
                                            })}

                                            {/* Existing Bookings Overlay */}
                                            {positionedBookings.map(booking => {
                                                const isInteracting = interaction && interaction.bookingId === booking.ids[0];
                                                if (isInteracting) return null;

                                                const isOwnBooking = booking.user_id === user.id;
                                                const canEdit = isAdmin || isOwnBooking;

                                                const isStarted = isBookingStarted(booking);

                                                const canMove = canEdit && (!isStarted || isAdminOverride);
                                                const canResizeTop = canEdit && (!isStarted || isAdminOverride);
                                                const canResizeBottom = canEdit;

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

                                                        {canResizeBottom && (
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
                            className="select-input text-sm"
                        >
                            <option value="General">General</option>
                            {profile?.projects?.map((proj, idx) => (
                                <option key={idx} value={proj}>{proj}</option>
                            ))}
                        </select>
                    </div>

                    <button onClick={onClose} className="btn btn-secondary">Cancel</button>

                    <button
                        disabled={(!editingBooking || editingBooking.user_id === user.id || isAdmin) && ((selectedSlots.length === 0 && !editingBooking) || isSubmitting)}
                        onClick={(e) => {
                            e.stopPropagation();
                            if (editingBooking && editingBooking.user_id !== user.id && (!isAdmin || !isBookingDirty)) {
                                setIsMessageModalOpen(true);
                            } else {
                                handleConfirmBooking();
                            }
                        }}
                        className={`btn w-[200px] flex items-center justify-center gap-2
                            ${(editingBooking && editingBooking.user_id !== user.id && (!isAdmin || !isBookingDirty))
                                ? 'bg-blue-100 text-blue-700 hover:bg-blue-200 dark:bg-blue-900/50 dark:text-blue-300 dark:hover:bg-blue-900/70'
                                : ((selectedSlots.length === 0 && !editingBooking) || isSubmitting
                                    ? 'bg-gray-300 cursor-not-allowed text-white'
                                    : 'btn-primary')
                            }`}
                    >
                        {(editingBooking && editingBooking.user_id !== user.id && (!isAdmin || !isBookingDirty)) ? (
                            <>
                                <i className="fas fa-envelope"></i> Send Message
                            </>
                        ) : (
                            <>
                                {isSubmitting && <i className="fas fa-spinner fa-spin"></i>}
                                {isSubmitting ? (editingBooking ? 'Updating...' : 'Booking...') : (editingBooking ? 'Update Booking' : 'Confirm Booking')}
                            </>
                        )}
                    </button>
                </div>

                {/* Message Modal */}
                {isMessageModalOpen && (
                    <div
                        className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] backdrop-blur-sm"
                        onClick={(e) => { e.stopPropagation(); setIsMessageModalOpen(false); }}
                    >
                        <div
                            className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl w-full max-w-md p-6 border dark:border-gray-700"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">Send Message to {editingBooking?.user_name || 'User'}</h3>

                            <div className="mb-4">
                                <label className="label">Subject</label>
                                <input
                                    type="text"
                                    value={messageSubject}
                                    onChange={(e) => setMessageSubject(e.target.value)}
                                    className="input-field"
                                    placeholder="e.g. Question about your booking"
                                />
                            </div>

                            <div className="mb-6">
                                <label className="label">Message</label>
                                <textarea
                                    value={messageBody}
                                    onChange={(e) => setMessageBody(e.target.value)}
                                    className="input-field h-32 resize-none"
                                    placeholder="Type your message here..."
                                ></textarea>
                            </div>

                            <div className="flex justify-end gap-3">
                                <button
                                    onClick={() => setIsMessageModalOpen(false)}
                                    className="btn btn-secondary"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleSendMessage}
                                    disabled={isSendingMessage}
                                    className="btn btn-primary flex items-center gap-2"
                                >
                                    {isSendingMessage && <i className="fas fa-spinner fa-spin"></i>}
                                    Send
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default BookingModal;
