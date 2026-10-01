import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import Icon from './Icon';
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
    isSlotInPast,
    isToolResponsibleUser,
    TOOL_ACCESS_LEVELS
} from '../utils/bookingUtils';
import { useBookingInteraction } from '../hooks/useBookingInteraction';
import { supabase } from '../supabaseClient';
import { useDialogFocus } from '../hooks/useDialogFocus';

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
    const [availability, setAvailability] = useState({ key: '', state: 'loading', message: '' });
    const requestRef = useRef(0);
    const [formDate, setFormDate] = useState(initialBooking?.date || initialDate || getVilniusNow().dateStr);
    const [formStart, setFormStart] = useState((initialBooking?.startTime || initialBooking?.time || '09:00').slice(0, 5));
    const [formEnd, setFormEnd] = useState((initialBooking?.endTime || initialBooking?.end_time || '09:30').slice(0, 5));
    const [formError, setFormError] = useState('');
    const [formNeedsCheck, setFormNeedsCheck] = useState(false);

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
    const dialogRef = useDialogFocus(!isMessageModalOpen, onClose);
    const messageDialogRef = useDialogFocus(isMessageModalOpen, () => setIsMessageModalOpen(false));

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
    const availabilityKey = `${tool?.id}:${weekStartStr}`;
    const availabilityReady = availability.key === availabilityKey && availability.state === 'ready';

    // Fetch tool availability for the active week window in modal (Fixes R5)
    const fetchToolWeekBookings = useCallback(async () => {
        if (!tool?.id) return;
        const request = ++requestRef.current;
        const key = `${tool.id}:${weekStartStr}`;
        setAvailability({ key, state: 'loading', message: '' });
        try {
            const all = [];
            let useFallback = false;
            for (let offset = 0; ;) {
                const selectFields = useFallback
                    ? 'id, tool_id, tool_name, user_id, user_name, project, date, time, end_time, starts_at, ends_at, created_at'
                    : 'id, tool_id, tool_name, user_id, user_name, project, date, time, end_time, starts_at, ends_at, created_at, status, confirmed_by, confirmed_at';

                let { data, error } = await supabase.from('bookings')
                    .select(selectFields)
                    .eq('tool_id', tool.id).gte('date', weekStartStr).lte('date', weekEndStr)
                    .order('date', { ascending: true }).order('time', { ascending: true }).order('id', { ascending: true })
                    .range(offset, offset + 499);

                if (error && !useFallback && (error.message?.includes('status') || error.message?.includes('does not exist') || error.message?.includes('column'))) {
                    useFallback = true;
                    const fallbackRes = await supabase.from('bookings')
                        .select('id, tool_id, tool_name, user_id, user_name, project, date, time, end_time, starts_at, ends_at, created_at')
                        .eq('tool_id', tool.id).gte('date', weekStartStr).lte('date', weekEndStr)
                        .order('date', { ascending: true }).order('time', { ascending: true }).order('id', { ascending: true })
                        .range(offset, offset + 499);
                    data = fallbackRes.data ? fallbackRes.data.map(b => ({ ...b, status: 'confirmed' })) : null;
                    error = fallbackRes.error;
                }

                if (error) throw error;
                if (!data?.length) break;
                const formatted = useFallback ? data.map(b => (b.status ? b : { ...b, status: 'confirmed' })) : data;
                all.push(...formatted);
                if (data.length < 500) break;
                offset += data.length;
            }
            if (request === requestRef.current) {
                setToolWeekBookings(all);
                setAvailability({ key, state: 'ready', message: '' });
            }
        } catch (err) {
            console.error('Error fetching tool week bookings:', err);
            if (request === requestRef.current) setAvailability({ key, state: 'error', message: 'Availability could not be checked. Retry before booking.' });
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
    const TOTAL_GRID_HEIGHT = 48 * PIXELS_PER_30_MINS; // 2304px (48 slots * 48px)

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
        // The modal's complete tool/week response replaces potentially stale dashboard data.
        if (availabilityReady) return toolWeekBookings;
        return existingBookings.filter(b => String(b.tool_id) === String(tool.id) && b.date >= weekStartStr && b.date <= weekEndStr);
    }, [availabilityReady, existingBookings, toolWeekBookings, tool.id, weekStartStr, weekEndStr]);

    const isResponsible = isAdmin || isToolResponsibleUser(tool, profile);

    const occupiedSlots = useMemo(() => {
        const occupied = new Set();
        for (const b of allKnownBookings) {
            if (String(b.tool_id ?? b.toolId) !== String(tool.id)) continue;
            if (b.status === 'rejected' || b.status === 'cancelled') continue;
            const start = getMinutes(b.startTime || b.time);
            const end = getMinutes(b.endTime || b.end_time || getNextSlotTime(b.startTime || b.time));
            for (let minutes = start; minutes < end; minutes += 30) occupied.add(`${b.date}:${minutes}`);
        }
        return occupied;
    }, [allKnownBookings, tool.id]);

    const isSlotBooked = useCallback((dateStr, timeStr) => occupiedSlots.has(`${dateStr}:${getMinutes(timeStr)}`), [occupiedSlots]);
    const selectedSlotKeys = useMemo(() => new Set(selectedSlots.map(s => `${s.date}:${s.time}`)), [selectedSlots]);
    const pastSlots = useMemo(() => {
        const result = new Set();
        for (const date of weekDates) for (const time of timeSlots) {
            const dateStr = formatDate(date);
            if (isSlotInPast(dateStr, time, currentTime)) result.add(`${dateStr}:${time}`);
        }
        return result;
    }, [weekDates, timeSlots, currentTime]);

    const handleFormDateChange = (date) => {
        setFormDate(date);
        setFormError('');
        setFormNeedsCheck(true);
        setSelectedSlots([]);
        if (date) setCurrentWeekStart(getMonday(date));
    };

    const handlePrevDay = () => {
        if (!formDate) return;
        const [y, m, d] = formDate.split('-').map(Number);
        const prevDate = new Date(y, m - 1, d - 1);
        handleFormDateChange(formatLocalDate(prevDate));
    };

    const handleNextDay = () => {
        if (!formDate) return;
        const [y, m, d] = formDate.split('-').map(Number);
        const nextDate = new Date(y, m - 1, d + 1);
        handleFormDateChange(formatLocalDate(nextDate));
    };

    const applyFormSelection = () => {
        setFormError('');
        if (!availabilityReady) { setFormError('Wait for availability to load, then retry.'); return; }
        if (!canBook) { setFormError(eligibility.reason || 'Booking is restricted.'); return; }
        const start = getMinutes(formStart);
        const end = getMinutes(formEnd);
        if (!formDate || start >= end || start % 30 || end % 30) {
            setFormError('Choose a date and a start/end time in 30-minute steps.'); return;
        }
        const slots = [];
        for (let minutes = start; minutes < end; minutes += 30) {
            const time = timeSlots[minutes / 30];
            const overlaps = editingBooking
                ? checkCollision({ tool_id: tool.id, date: formDate, time, end_time: getNextSlotTime(time) }, allKnownBookings, editingBooking.ids || [editingBooking.id])
                : isSlotBooked(formDate, time);
            if (!time || overlaps || (!isAdminOverride && isSlotInPast(formDate, time, currentTime))) {
                setFormError('That range contains a booked or past time. Choose another range.'); return;
            }
            slots.push({ date: formDate, time });
        }
        if (editingBooking) {
            setEditingBooking(prev => ({ ...prev, date: formDate, startTime: formStart, endTime: formEnd }));
        } else {
            setSelectedSlots(slots);
        }
        setFormNeedsCheck(false);
    };

    // Quick duration preset applicator
    const applyDuration = (hours, minutes = 0) => {
        const startMinutes = getMinutes(formStart);
        const totalMinutes = (hours * 60) + minutes;
        const targetEndMinutes = Math.min(24 * 60, startMinutes + totalMinutes);
        const endH = Math.floor(targetEndMinutes / 60);
        const endM = targetEndMinutes % 60;
        const endStr = `${endH < 10 ? '0' + endH : endH}:${endM < 10 ? '0' + endM : endM}`;
        setFormEnd(endStr);
        setFormError('');

        if (!availabilityReady) {
            setFormNeedsCheck(true);
            return;
        }
        if (!canBook) {
            setFormError(eligibility.reason || 'Booking is restricted.');
            return;
        }

        const slots = [];
        for (let m = startMinutes; m < targetEndMinutes; m += 30) {
            const time = timeSlots[m / 30];
            const overlaps = editingBooking
                ? checkCollision({ tool_id: tool.id, date: formDate, time, end_time: getNextSlotTime(time) }, allKnownBookings, editingBooking.ids || [editingBooking.id])
                : isSlotBooked(formDate, time);
            if (!time || overlaps || (!isAdminOverride && isSlotInPast(formDate, time, currentTime))) {
                setFormError(`Requested duration contains booked or past slot: ${time}`);
                setFormNeedsCheck(true);
                return;
            }
            slots.push({ date: formDate, time });
        }

        if (editingBooking) {
            setEditingBooking(prev => ({ ...prev, date: formDate, startTime: formStart, endTime: endStr }));
        } else {
            setSelectedSlots(slots);
        }
        setFormNeedsCheck(false);
    };

    // Mobile slot tap handler (tap to select, tap later slot to extend range)
    const handleSlotTap = (time) => {
        if (!canBook) {
            setFormError(eligibility.reason || 'Booking is restricted.');
            return;
        }
        const nextSlot = getNextSlotTime(time);
        const isBooked = isSlotBooked(formDate, time);
        const isPast = !isAdminOverride && isSlotInPast(formDate, time, currentTime);
        if (isBooked || isPast) return;

        // If a slot is already selected on the same day and user clicks a later slot, extend selection
        if (selectedSlots.length > 0 && selectedSlots[0].date === formDate) {
            const firstMin = getMinutes(selectedSlots[0].time);
            const clickedMin = getMinutes(time);
            if (clickedMin > firstMin) {
                const slots = [];
                let blocked = false;
                for (let m = firstMin; m <= clickedMin; m += 30) {
                    const t = timeSlots[m / 30];
                    const overlaps = isSlotBooked(formDate, t);
                    if (!t || overlaps || (!isAdminOverride && isSlotInPast(formDate, t, currentTime))) {
                        blocked = true;
                        break;
                    }
                    slots.push({ date: formDate, time: t });
                }
                if (!blocked) {
                    const newEnd = getNextSlotTime(time);
                    setFormStart(selectedSlots[0].time);
                    setFormEnd(newEnd);
                    setSelectedSlots(slots);
                    setFormError('');
                    setFormNeedsCheck(false);
                    return;
                }
            }
        }

        // Single slot select
        setFormStart(time);
        setFormEnd(nextSlot);
        setSelectedSlots([{ date: formDate, time }]);
        setFormError('');
        setFormNeedsCheck(false);
    };

    const getCurrentTimeTop = () => {
        const totalMinutes = getVilniusCurrentMinutes(currentTime);
        return (totalMinutes / 30) * PIXELS_PER_30_MINS;
    };

    const isToday = (date) => isVilniusToday(date, currentTime);

    // Group bookings for display (Pending bookings only appear for Tool Responsible, Admin, or creator)
    const displayBookings = useMemo(() => {
        const visibleKnown = allKnownBookings.filter(b => {
            if (b.status === 'pending_approval') {
                return isResponsible || b.user_id === user.id;
            }
            return b.status !== 'rejected' && b.status !== 'cancelled';
        });

        if (!editingBooking) return visibleKnown;

        const editIds = editingBooking.ids || [editingBooking.id];
        const primaryId = editIds[0];

        if (!primaryId) return visibleKnown;

        return visibleKnown.map(b => {
            if (b.id === primaryId) {
                return editingBooking;
            }
            if (editIds.includes(b.id)) return null;
            return b;
        }).filter(Boolean);
    }, [allKnownBookings, editingBooking, isResponsible, user.id]);

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
            setFormDate(newBooking.date);
            setFormStart(newBooking.startTime);
            setFormEnd(newBooking.endTime);
            setFormNeedsCheck(false);
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
        setFormDate(booking.date);
        setFormStart(booking.startTime);
        setFormEnd(booking.endTime);
        setFormNeedsCheck(false);
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
                if (!isSlotBooked(dStr, tStr) && (isAdminOverride || !pastSlots.has(`${dStr}:${tStr}`))) {
                    newSlots.push({ date: dStr, time: tStr });
                }
            }
        }

        setSelectedSlots(newSlots);
        if (newSlots.length > 0) {
            const sorted = [...newSlots].sort((a, b) => {
                if (a.date !== b.date) return a.date.localeCompare(b.date);
                return a.time.localeCompare(b.time);
            });
            setFormDate(sorted[0].date);
            setFormStart(sorted[0].time);
            setFormEnd(getNextSlotTime(sorted[sorted.length - 1].time));
        }
    }, [weekDates, timeSlots, isAdminOverride, isSlotBooked, pastSlots]);

    const handleGridMouseDown = (dateStr, timeIndex) => {
        setEditingBooking(null);
        if (!canBook || !availabilityReady) return;

        const timeStr = timeSlots[timeIndex];
        if (isSlotBooked(dateStr, timeStr)) return;
        if (isSlotInPast(dateStr, timeStr) && !isAdminOverride) {
            showToast('Cannot book in the past.', 'error');
            return;
        }

        setIsSelecting(true);
        setFormNeedsCheck(false);
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

    // Week navigation (Fixes R11, R6)
    const handlePrevWeek = useCallback(() => {
        setSelectedSlots([]);
        setCurrentWeekStart(prev => addDays(prev, -7));
    }, []);

    const handleNextWeek = useCallback(() => {
        setSelectedSlots([]);
        setCurrentWeekStart(prev => addDays(prev, 7));
    }, []);

    const handleToday = useCallback(() => {
        setSelectedSlots([]);
        setCurrentWeekStart(getMonday(getVilniusNow(currentTime).dateStr));
    }, [currentTime]);

    // Keyboard shortcuts for PC desktop users (T = Today, Alt+Left = Prev Week, Alt+Right = Next Week)
    useEffect(() => {
        const handleKeyDown = (e) => {
            const tagName = document.activeElement?.tagName?.toLowerCase();
            if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') return;

            if (e.key === 't' || e.key === 'T') {
                e.preventDefault();
                handleToday();
            } else if (e.key === 'ArrowLeft' && e.altKey) {
                e.preventDefault();
                handlePrevWeek();
            } else if (e.key === 'ArrowRight' && e.altKey) {
                e.preventDefault();
                handleNextWeek();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [handleToday, handlePrevWeek, handleNextWeek]);

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
            setFormNeedsCheck(false);
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

    // Mutation with draft preservation (L5)
    const handleConfirmBooking = async () => {
        if (formNeedsCheck) {
            setFormError('Check the changed date and time before confirming.');
            return;
        }
        if (!availabilityReady) {
            setFormError('Availability is not confirmed. Retry the availability check.');
            return;
        }
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

            const isPending = eligibility.requiresConfirmation;
            const newBookings = ranges.map(range => ({
                tool_id: tool.id,
                tool_name: tool.name,
                user_id: user.id,
                user_name: profile ? `${profile.first_name || ''} ${profile.last_name || ''}`.trim() : user.email,
                project: selectedProject,
                date: range.date,
                time: range.startTime,
                end_time: range.endTime,
                status: isPending ? 'pending_approval' : 'confirmed',
                created_at: now
            }));

            const hasCollision = newBookings.some(newB => checkCollision(newB, allKnownBookings));
            if (hasCollision) {
                showToast('One or more selected slots are already booked.', 'error');
                return;
            }

            const result = await onConfirm(newBookings);
            if (result?.success) {
                setSelectedSlots([]);
                if (isPending) {
                    showToast('Reservation submitted! Awaiting confirmation from Tool Responsible.', 'success');
                }
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
            <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="booking-dialog-title" tabIndex={-1} className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-7xl h-auto max-h-[96vh] md:h-[95vh] flex flex-col overflow-hidden border dark:border-gray-700 transition-colors" onClick={(e) => e.stopPropagation()}>
                {/* Header */}
                <div className="p-4 border-b dark:border-gray-700 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white dark:bg-gray-800 shrink-0 z-30 transition-colors">
                    <div>
                        <div className="flex flex-wrap items-center gap-2">
                            <h2 id="booking-dialog-title" className="text-xl font-bold text-gray-800 dark:text-gray-100">Book {tool.name}</h2>
                            <StatusBadge status={tool.status} />
                            {isAdmin && (tool.status !== 'up' || (tool.license_req && eligibility.level === TOOL_ACCESS_LEVELS.NONE)) && (
                                <span className="text-xs text-amber-800 dark:text-amber-200 bg-amber-100 dark:bg-amber-900/40 px-2 py-0.5 rounded font-medium">Administrator equipment override</span>
                            )}
                            {isAdminOverride && <span className="text-xs text-amber-800 dark:text-amber-200 bg-amber-100 dark:bg-amber-900/40 px-2 py-0.5 rounded font-medium">Past-time override</span>}
                            {eligibility.level === TOOL_ACCESS_LEVELS.LEVEL_2 && (
                                <span className="text-xs text-blue-800 dark:text-blue-200 bg-blue-100 dark:bg-blue-900/40 px-2 py-0.5 rounded font-medium flex items-center gap-1">
                                    <Icon className="fas fa-user-check text-[10px]" /> Level II (Requires Confirmation)
                                </span>
                            )}
                            {eligibility.level === TOOL_ACCESS_LEVELS.LEVEL_1 && (
                                <span className="text-xs text-amber-800 dark:text-amber-200 bg-amber-100 dark:bg-amber-900/40 px-2 py-0.5 rounded font-medium flex items-center gap-1">
                                    <Icon className="fas fa-user-graduate text-[10px]" /> Level I (In Training)
                                </span>
                            )}
                            {!canBook && eligibility.level !== TOOL_ACCESS_LEVELS.LEVEL_1 && (
                                <span className="bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 text-xs px-2 py-0.5 rounded font-medium">
                                    {eligibility.reason || 'Booking Restricted'}
                                </span>
                            )}
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                            {tool.category} &bull; {tool.location || 'Lab'} &bull; Responsible: <span className="font-semibold text-gray-700 dark:text-gray-200">{tool.primary_responsible ? `${tool.primary_responsible.first_name || ''} ${tool.primary_responsible.last_name || ''}`.trim() : 'Lab Administrator'}</span>{tool.primary_responsible?.email ? ` (${tool.primary_responsible.email})` : ''} &bull; Lab Timezone: Europe/Vilnius
                        </p>
                    </div>

                    <div className="flex items-center gap-2 self-stretch md:self-auto justify-between md:justify-end">
                        <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-700 p-1 rounded-lg">
                            <button onClick={handlePrevWeek} className="btn-icon text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-600" title="Previous Week (Alt+Left)">
                                <Icon className="fas fa-chevron-left text-xs" />
                            </button>
                            <button onClick={handleToday} className="px-2 py-1 text-xs font-semibold text-gray-700 dark:text-gray-200 hover:bg-white dark:hover:bg-gray-600 rounded" title="Jump to today (T)">
                                Today
                            </button>
                            <button onClick={handleNextWeek} className="btn-icon text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-600" title="Next Week (Alt+Right)">
                                <Icon className="fas fa-chevron-right text-xs" />
                            </button>
                        </div>
                        <span className="text-xs sm:text-sm font-semibold text-gray-700 dark:text-gray-200 mx-2">
                            {displayDate(weekDates[0])} - {displayDate(weekDates[6])}
                        </span>
                        <button onClick={onClose} aria-label="Close booking dialog" className="btn-icon text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                            <Icon aria-hidden="true" className="fas fa-times text-lg" />
                        </button>
                    </div>
                </div>

                {/* Level Notice Banners */}
                {eligibility.level === TOOL_ACCESS_LEVELS.LEVEL_2 && (
                    <div className="bg-blue-50 dark:bg-blue-900/30 border-b border-blue-200 dark:border-blue-800/40 px-4 py-2 text-xs text-blue-800 dark:text-blue-200 flex items-center gap-2 shrink-0">
                        <Icon className="fas fa-info-circle text-blue-600 dark:text-blue-400 shrink-0" />
                        <span>Notice: As a <strong>Level II (Supervised)</strong> operator, your reservation will be tentatively held and submitted for confirmation by the Tool Responsible. It will appear on the active calendar once approved.</span>
                    </div>
                )}
                {eligibility.level === TOOL_ACCESS_LEVELS.LEVEL_1 && (
                    <div className="bg-amber-50 dark:bg-amber-900/30 border-b border-amber-200 dark:border-amber-800/40 px-4 py-2 text-xs text-amber-800 dark:text-amber-200 flex items-center gap-2 shrink-0">
                        <Icon className="fas fa-user-graduate text-amber-600 dark:text-amber-400 shrink-0" />
                        <span>Notice: You currently have <strong>Level I (In Training)</strong> access for this instrument. Equipment booking is restricted until training is completed and your access is upgraded.</span>
                    </div>
                )}

                {/* Form and Controls Section */}
                <div className="p-4 border-b dark:border-gray-700 bg-gray-50 dark:bg-gray-900 space-y-3 overflow-y-auto shrink-0 max-h-[58vh]">
                    <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-2">
                        <div>
                            <h3 className="font-semibold text-gray-800 dark:text-gray-100 text-sm">Choose a booking time</h3>
                            <p className="text-xs text-gray-600 dark:text-gray-400">Select date and duration or tap slots on the timeline below.</p>
                        </div>
                        {/* Quick Presets */}
                        <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-[11px] text-gray-500 dark:text-gray-400 font-medium">Quick duration:</span>
                            {[
                                { label: '30m', h: 0, m: 30 },
                                { label: '1h', h: 1, m: 0 },
                                { label: '2h', h: 2, m: 0 },
                                { label: '3h', h: 3, m: 0 },
                                { label: '4h', h: 4, m: 0 },
                                { label: '8h', h: 8, m: 0 }
                            ].map(d => (
                                <button
                                    key={d.label}
                                    type="button"
                                    onClick={() => applyDuration(d.h, d.m)}
                                    className="px-2 py-0.5 text-xs font-medium rounded bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-blue-50 dark:hover:bg-blue-900/30 hover:border-blue-300 transition-colors shadow-2xs cursor-pointer"
                                >
                                    +{d.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3 items-end">
                        <label className="text-xs font-medium text-gray-700 dark:text-gray-200">
                            Date
                            <div className="flex items-center gap-1 mt-1">
                                <button
                                    type="button"
                                    onClick={handlePrevDay}
                                    className="p-1.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 shrink-0 cursor-pointer min-h-[36px] min-w-[32px] flex items-center justify-center"
                                    title="Previous Day"
                                >
                                    <Icon className="fas fa-chevron-left text-[10px]" />
                                </button>
                                <input
                                    type="date"
                                    className="input-field flex-1 text-xs py-1.5 min-h-[36px]"
                                    value={formDate}
                                    onChange={e => handleFormDateChange(e.target.value)}
                                />
                                <button
                                    type="button"
                                    onClick={handleNextDay}
                                    className="p-1.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 shrink-0 cursor-pointer min-h-[36px] min-w-[32px] flex items-center justify-center"
                                    title="Next Day"
                                >
                                    <Icon className="fas fa-chevron-right text-[10px]" />
                                </button>
                            </div>
                        </label>
                        <label className="text-xs font-medium text-gray-700 dark:text-gray-200">Start
                            <select className="select-input w-full mt-1 text-xs min-h-[36px]" value={formStart} onChange={e => { setFormStart(e.target.value); setFormError(''); setFormNeedsCheck(true); setSelectedSlots([]); }}>
                                {timeSlots.map(time => <option key={time} value={time}>{time}</option>)}
                            </select>
                        </label>
                        <label className="text-xs font-medium text-gray-700 dark:text-gray-200">End
                            <select className="select-input w-full mt-1 text-xs min-h-[36px]" value={formEnd} onChange={e => { setFormEnd(e.target.value); setFormError(''); setFormNeedsCheck(true); setSelectedSlots([]); }}>
                                {[...timeSlots.slice(1), '24:00'].map(time => <option key={time} value={time}>{time}</option>)}
                            </select>
                        </label>
                        <label className="text-xs font-medium text-gray-700 dark:text-gray-200">Project
                            <select value={selectedProject} onChange={e => setSelectedProject(e.target.value)} className="select-input w-full mt-1 text-xs min-h-[36px]">
                                <option value="General">General</option>
                                {profile?.projects?.map(proj => <option key={proj} value={proj}>{proj}</option>)}
                            </select>
                        </label>
                        <button type="button" onClick={applyFormSelection} disabled={!canBook || !availabilityReady} className="btn btn-primary text-xs min-h-[36px]">Check time</button>
                    </div>

                    <div role="status" aria-live="polite" className="text-xs text-gray-700 dark:text-gray-200">
                        {availability.key !== availabilityKey || availability.state === 'loading' ? 'Checking availability…' : availability.state === 'error' ? availability.message : 'Availability loaded.'}
                        {availability.state === 'error' && <button type="button" onClick={fetchToolWeekBookings} className="ml-2 underline text-blue-700 dark:text-blue-300 cursor-pointer">Retry</button>}
                    </div>
                    {formError && <p role="alert" className="text-xs text-red-700 dark:text-red-300 font-semibold">{formError}</p>}
                    {formNeedsCheck && <p className="text-xs text-amber-700 dark:text-amber-300">Check this time to apply your changes.</p>}

                    {/* Selected Summary Card */}
                    {selectedSlots.length > 0 && !editingBooking && (
                        <div className="bg-blue-50 dark:bg-blue-950/60 border border-blue-300 dark:border-blue-700/80 rounded-lg p-2.5 flex items-center justify-between text-xs text-blue-950 dark:text-blue-100 shadow-2xs animate-fadeIn">
                            <div className="flex items-center gap-2">
                                <Icon className="fas fa-check-circle text-blue-600 dark:text-blue-400 text-sm" />
                                <div>
                                    <span className="font-bold">
                                        Selected: {selectedSlots[0].date}{selectedSlots[0].date !== selectedSlots[selectedSlots.length - 1].date ? ` through ${selectedSlots[selectedSlots.length - 1].date}` : ''}, {selectedSlots[0].time}–{getNextSlotTime(selectedSlots[selectedSlots.length - 1].time)}
                                    </span>
                                    <span className="ml-2 font-medium opacity-85">
                                        ({Math.floor((selectedSlots.length * 30) / 60)}h {(selectedSlots.length * 30) % 60 ? `${(selectedSlots.length * 30) % 60}m` : ''}) &bull; {selectedProject}
                                    </span>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => setSelectedSlots([])}
                                className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-200 hover:underline font-semibold text-xs ml-2 cursor-pointer"
                            >
                                Clear
                            </button>
                        </div>
                    )}
                    {editingBooking && (
                        <p className="text-xs font-semibold text-blue-800 dark:text-blue-200">
                            Reservation: {editingBooking.date}, {editingBooking.startTime}–{editingBooking.endTime}, {selectedProject}
                        </p>
                    )}

                    {/* Mobile Day Availability Timeline & Slot Picker (Visible on mobile screens) */}
                    <div className="md:hidden pt-3 border-t dark:border-gray-700 space-y-2.5">
                        <div className="flex items-center justify-between">
                            <div className="text-xs font-bold uppercase tracking-wider text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
                                <Icon className="fas fa-calendar-day text-blue-600 dark:text-blue-400" />
                                <span>Day Timeline ({formDate})</span>
                            </div>
                            <div className="flex items-center gap-2 text-[10px] text-gray-500 dark:text-gray-400">
                                <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500"></span> Free</span>
                                <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-600 dark:bg-blue-400"></span> Selected</span>
                                <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-gray-400"></span> Busy</span>
                            </div>
                        </div>

                        <div className="grid grid-cols-4 sm:grid-cols-6 gap-1.5 max-h-52 overflow-y-auto p-1.5 border dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800">
                            {timeSlots.map(time => {
                                const isBooked = isSlotBooked(formDate, time);
                                const isPast = !isAdminOverride && isSlotInPast(formDate, time, currentTime);
                                const isSelected = selectedSlotKeys.has(`${formDate}:${time}`);
                                const slotBooking = isBooked ? groupedBookings.find(b => {
                                    if (b.date !== formDate) return false;
                                    const sm = getMinutes(time);
                                    const bmStart = getMinutes(b.startTime || b.time);
                                    const bmEnd = getMinutes(b.endTime || b.end_time || getNextSlotTime(b.startTime || b.time));
                                    return sm >= bmStart && sm < bmEnd;
                                }) : null;

                                const isOwnBooking = slotBooking?.user_id === user.id;

                                let chipStyle = "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/40 hover:bg-emerald-100 cursor-pointer";
                                if (isSelected) {
                                    chipStyle = "bg-blue-600 dark:bg-blue-500 text-white border-blue-700 dark:border-blue-300 font-bold shadow-xs cursor-pointer ring-2 ring-blue-500/40 dark:ring-blue-400/60";
                                } else if (isBooked) {
                                    chipStyle = isOwnBooking
                                        ? "bg-blue-100 dark:bg-blue-900/40 text-blue-900 dark:text-blue-200 border-blue-300 dark:border-blue-700 opacity-80 cursor-not-allowed"
                                        : "bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-600 opacity-60 cursor-not-allowed";
                                } else if (isPast) {
                                    chipStyle = "bg-gray-50 dark:bg-gray-800/40 text-gray-400 dark:text-gray-500 border-gray-200 dark:border-gray-700/50 opacity-40 cursor-not-allowed";
                                }

                                return (
                                    <button
                                        key={time}
                                        type="button"
                                        disabled={(isBooked && !isSelected) || isPast}
                                        onClick={() => handleSlotTap(time)}
                                        className={`py-1.5 px-1 rounded text-xs border text-center transition-all flex flex-col items-center justify-center min-h-[42px] ${chipStyle}`}
                                        title={isBooked ? `Booked by ${slotBooking?.user_name || 'User'}` : isPast ? 'Past slot' : `Select ${time}`}
                                    >
                                        <span className="font-mono text-xs">{time}</span>
                                        {isBooked ? (
                                            <span className="text-[9px] truncate max-w-full px-0.5 leading-none mt-0.5 opacity-90">
                                                {isOwnBooking ? 'Mine' : (slotBooking?.user_name?.split(' ')[0] || 'Busy')}
                                            </span>
                                        ) : isSelected ? (
                                            <span className="text-[9px] leading-none mt-0.5">Selected</span>
                                        ) : null}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>

                {/* Calendar Body (Desktop) */}
                <div ref={scrollContainerRef} className="hidden md:flex flex-1 overflow-y-auto relative select-none flex-col bg-white dark:bg-gray-800 transition-colors" aria-label="Visual week calendar; use the form above for keyboard booking">
                    {/* Live Drag/Selection Duration Tooltip Badge */}
                    {selectedSlots.length > 0 && (
                        <div className="sticky top-12 left-1/2 -translate-x-1/2 z-30 pointer-events-none self-center bg-blue-600 dark:bg-blue-500 text-white text-xs font-semibold px-3.5 py-1.5 rounded-full shadow-lg border border-blue-400/30 dark:border-blue-300/40 backdrop-blur-xs flex items-center gap-2 animate-fadeIn">
                            <Icon className="fas fa-clock text-[11px]" />
                            <span>
                                {selectedSlots[0].time} – {getNextSlotTime(selectedSlots[selectedSlots.length - 1].time)}
                                {' '}({Math.floor((selectedSlots.length * 30) / 60)}h {(selectedSlots.length * 30) % 60 ? `${(selectedSlots.length * 30) % 60}m` : ''})
                            </span>
                        </div>
                    )}

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

                    <div className="flex flex-1 relative" style={{ minHeight: `${TOTAL_GRID_HEIGHT}px` }}>
                        {/* Time labels */}
                        <div className="w-16 shrink-0 border-r dark:border-gray-700 bg-gray-50/50 dark:bg-gray-900/20 select-none">
                            {timeSlots.map((time, idx) => (
                                <div key={idx} className="h-12 border-b dark:border-gray-700/50 text-[10px] text-gray-400 text-right pr-2 pt-1 font-mono">
                                    {time.endsWith(':00') ? time : ''}
                                </div>
                            ))}
                        </div>

                        {/* Grid Columns */}
                        <div className="flex-1 grid grid-cols-7 relative" style={{ minHeight: `${TOTAL_GRID_HEIGHT}px` }}>
                            {weekDates.map((date, dayIdx) => {
                                const dateStr = formatDate(date);
                                const dayBookings = groupedBookings.filter(b => b.date === dateStr);
                                const positionedBookings = calculateEventLayout(dayBookings);

                                const isTargetDay = interaction && interaction.currentDate === dateStr;
                                const interactingBooking = interaction ? interaction.originalBooking : null;

                                return (
                                    <div
                                        key={dayIdx}
                                        className={`border-r dark:border-gray-700 last:border-0 relative ${isToday(date) ? 'bg-blue-50/10' : ''}`}
                                        style={{ minHeight: `${TOTAL_GRID_HEIGHT}px` }}
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
                                        <div className="relative" style={{ minHeight: `${TOTAL_GRID_HEIGHT}px` }}>
                                            {timeSlots.map((time, timeIdx) => {
                                                const isBooked = isSlotBooked(dateStr, time);
                                                const isPast = pastSlots.has(`${dateStr}:${time}`);
                                                const isSelected = selectedSlotKeys.has(`${dateStr}:${time}`);
                                                const isPrevSelected = isSelected && timeIdx > 0 && selectedSlotKeys.has(`${dateStr}:${timeSlots[timeIdx - 1]}`);
                                                const isNextSelected = isSelected && timeIdx < timeSlots.length - 1 && selectedSlotKeys.has(`${dateStr}:${timeSlots[timeIdx + 1]}`);

                                                return (
                                                    <div
                                                        key={timeIdx}
                                                        data-date={dateStr}
                                                        data-timeindex={timeIdx}
                                                        onMouseDown={() => handleGridMouseDown(dateStr, timeIdx)}
                                                        onMouseEnter={() => handleMouseEnter(dateStr, timeIdx)}
                                                        onTouchStart={(e) => handleGridTouchStart(e, dateStr, timeIdx)}
                                                        onTouchEnd={handleGridTouchEnd}
                                                        className={`h-12 transition-colors cursor-pointer relative
                                                            ${isSelected
                                                                ? `z-[5] bg-blue-500/20 dark:bg-blue-500/35 border-l-4 border-l-blue-600 dark:border-l-blue-400 border-r-2 border-r-blue-600 dark:border-r-blue-400 hover:bg-blue-500/30 dark:hover:bg-blue-500/45 !opacity-100 ${
                                                                    !isPrevSelected ? 'border-t-2 border-t-blue-600 dark:border-t-blue-400 rounded-t-md' : ''
                                                                } ${
                                                                    !isNextSelected ? 'border-b-2 border-b-blue-600 dark:border-b-blue-400 rounded-b-md shadow-xs' : 'border-b border-b-blue-300/80 dark:border-b-blue-500/50 border-dashed'
                                                                }`
                                                                : `border-b dark:border-gray-700/50 ${
                                                                    time.endsWith(':00') ? 'border-b-gray-200 dark:border-b-gray-700' : 'border-b-gray-100 dark:border-b-gray-800/40'
                                                                } ${
                                                                    isBooked ? 'bg-stripes-gray cursor-not-allowed opacity-40' : ''
                                                                } ${
                                                                    isPast && !isAdminOverride ? 'bg-gray-50/80 dark:bg-gray-800/40 cursor-not-allowed text-gray-300 dark:text-gray-600' : 'hover:bg-blue-50/30 dark:hover:bg-blue-900/10'
                                                                }`
                                                            }
                                                        `}
                                                    >
                                                        {isSelected && (
                                                            <div className="h-full w-full flex flex-col justify-center px-2 pointer-events-none select-none overflow-hidden">
                                                                {!isPrevSelected ? (
                                                                    <div className="flex items-center justify-between gap-1">
                                                                        <span className="text-[11px] font-bold text-blue-950 dark:text-blue-100 flex items-center gap-1.5 truncate">
                                                                            <span className="w-2 h-2 rounded-full bg-blue-600 dark:bg-blue-400 shrink-0"></span>
                                                                            <span className="truncate">{time}</span>
                                                                        </span>
                                                                        {!isNextSelected && (
                                                                            <span className="text-[10px] font-bold text-blue-800 dark:text-blue-200 shrink-0">
                                                                                {getNextSlotTime(time)}
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                ) : !isNextSelected ? (
                                                                    <div className="flex items-center justify-between gap-1">
                                                                        <span className="text-[10px] font-medium text-blue-900 dark:text-blue-200 truncate">
                                                                            {time}
                                                                        </span>
                                                                        <span className="text-[10px] font-bold text-blue-950 dark:text-blue-100 shrink-0">
                                                                            Until {getNextSlotTime(time)}
                                                                        </span>
                                                                    </div>
                                                                ) : (
                                                                    <div className="text-[10px] font-medium text-blue-800/80 dark:text-blue-200/80 truncate">
                                                                        {time}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}

                                            {/* Existing Bookings Overlay */}
                                            {positionedBookings.map(booking => {
                                                const isInteracting = interaction && interaction.bookingId === booking.ids[0];
                                                if (isInteracting) return null;

                                                const isOwnBooking = booking.user_id === user.id;
                                                const isPending = booking.status === 'pending_approval';
                                                const canEdit = isAdmin || isOwnBooking;

                                                const isStarted = isBookingStarted(booking);

                                                const canMove = canEdit && (!isStarted || isAdminOverride);
                                                const canResizeTop = canEdit && (!isStarted || isAdminOverride);
                                                const canResizeBottom = canEdit;

                                                return (
                                                    <div
                                                        key={booking.ids[0]}
                                                        className={`absolute border rounded p-1 text-xs overflow-hidden transition-all group 
                                                            ${isPending
                                                                ? 'bg-amber-100/90 dark:bg-amber-900/40 border-dashed border-amber-400 dark:border-amber-600 text-amber-950 dark:text-amber-100'
                                                                : isOwnBooking
                                                                    ? 'bg-blue-100 dark:bg-blue-900/60 border-blue-300 dark:border-blue-700'
                                                                    : 'bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600'}
                                                            ${canEdit ? 'hover:z-10 hover:shadow-md cursor-pointer' : ''}
                                                            ${editingBooking && editingBooking.id === booking.ids[0] ? 'ring-2 ring-blue-500 z-20' : ''}
                                                            `}
                                                        style={getEventStyle(booking)}
                                                        onMouseDown={(e) => canMove && startInteraction(e, booking, 'move')}
                                                        onTouchStart={(e) => canMove && handleBookingTouchStart(e, booking, 'move')}
                                                        onTouchMove={handleBookingTouchMove}
                                                        onTouchEnd={handleBookingTouchEnd}
                                                        onClick={(e) => handleBookingClick(e, booking)}
                                                        role="button"
                                                        tabIndex={canEdit ? 0 : -1}
                                                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleBookingClick(e, booking); } }}
                                                        aria-label={`${booking.user_name}, ${booking.project}, ${booking.startTime} to ${booking.endTime}${isPending ? ' (Pending Confirmation)' : ''}`}
                                                        title={`Booked by: ${booking.user_name}\nProject: ${booking.project}${isPending ? '\nStatus: Pending Confirmation' : ''}`}
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

                                                        <div className={`font-bold truncate pointer-events-none flex items-center gap-1 ${isPending ? 'text-amber-900 dark:text-amber-100' : isOwnBooking ? 'text-blue-900 dark:text-blue-100' : 'text-gray-800 dark:text-gray-200'}`}>
                                                            {isPending && <Icon className="fas fa-clock text-amber-600 text-[10px]" />}
                                                            <span className="truncate">{booking.user_name}</span>
                                                            {isPending && <span className="text-[10px] text-amber-700 dark:text-amber-300 font-semibold shrink-0">(Pending)</span>}
                                                        </div>
                                                        <div className={`truncate text-[10px] pointer-events-none ${isPending ? 'text-amber-700 dark:text-amber-300' : isOwnBooking ? 'text-blue-700 dark:text-blue-300' : 'text-gray-600 dark:text-gray-400'}`}>{booking.project}</div>

                                                        {editingBooking && editingBooking.id === booking.ids[0] && (isAdmin || isOwnBooking) && (!isStarted || isAdminOverride) && (
                                                            <div
                                                                className="absolute top-0 right-0 p-1 cursor-pointer text-red-600 hover:text-red-800 bg-white/50 hover:bg-white rounded-bl z-30"
                                                                onClick={(e) => handleCancelClick(e, booking)}
                                                                title="Cancel Booking"
                                                            >
                                                                <Icon className="fas fa-times text-xs" />
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
                                                    className={`absolute border border-dashed rounded p-1 text-xs overflow-hidden z-50 opacity-90 pointer-events-none shadow-md
                                                        ${interaction.isValid
                                                            ? 'bg-blue-100 dark:bg-blue-900/80 border-blue-500 dark:border-blue-400 text-blue-900 dark:text-blue-100'
                                                            : 'bg-red-100 dark:bg-red-900/80 border-red-500 dark:border-red-400 text-red-900 dark:text-red-100'
                                                        }`}
                                                    style={{
                                                        top: `${interaction.currentTop}px`,
                                                        height: `${interaction.currentHeight - 1}px`,
                                                        left: '2px',
                                                        right: '2px'
                                                    }}
                                                >
                                                    <div className={`font-bold truncate ${interaction.isValid ? 'text-blue-900 dark:text-blue-100' : 'text-red-900 dark:text-red-100'}`}>
                                                        {interactingBooking.user_name}
                                                    </div>
                                                    <div className={`truncate text-[10px] ${interaction.isValid ? 'text-blue-700 dark:text-blue-300' : 'text-red-700 dark:text-red-300'}`}>
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
                    <div className="mr-auto hidden md:flex flex-wrap items-center gap-4 text-sm mb-2 sm:mb-0 text-gray-600 dark:text-gray-400">
                        <div className="flex items-center gap-1.5"><div className="w-4 h-4 bg-white dark:bg-gray-800 border dark:border-gray-600 rounded"></div> Available</div>
                        <div className="flex items-center gap-1.5"><div className="w-4 h-4 bg-blue-500/25 dark:bg-blue-500/35 border-2 border-l-4 border-blue-600 dark:border-blue-400 rounded"></div> Selected</div>
                        <div className="flex items-center gap-1.5"><div className="w-4 h-4 bg-blue-100 dark:bg-blue-900/60 border border-blue-300 dark:border-blue-700 rounded"></div> My Booking</div>
                        <div className="flex items-center gap-1.5"><div className="w-4 h-4 bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded"></div> Other's Booking</div>
                    </div>

                    <button onClick={onClose} className="btn btn-secondary">Cancel</button>

                    <button
                        disabled={(!editingBooking || editingBooking.user_id === user.id || isAdmin) && ((selectedSlots.length === 0 && !editingBooking) || isSubmitting || !availabilityReady || formNeedsCheck)}
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
                                <Icon className="fas fa-envelope" /> Send Message
                            </>
                        ) : (
                            <>
                                {isSubmitting && <Icon className="fas fa-spinner fa-spin" />}
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
                        <div ref={messageDialogRef} role="dialog" aria-modal="true" aria-labelledby="message-dialog-title" tabIndex={-1}
                            className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl w-full max-w-md p-6 border dark:border-gray-700"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <h3 id="message-dialog-title" className="text-lg font-bold text-gray-900 dark:text-white mb-4">Send Message to {editingBooking?.user_name || 'User'}</h3>

                            <div className="mb-4">
                                <label htmlFor="booking-message-subject" className="label">Subject</label>
                                <input
                                    id="booking-message-subject"
                                    type="text"
                                    value={messageSubject}
                                    onChange={(e) => setMessageSubject(e.target.value)}
                                    className="input-field"
                                    placeholder="e.g. Question about your booking"
                                />
                            </div>

                            <div className="mb-6">
                                <label htmlFor="booking-message-body" className="label">Message</label>
                                <textarea
                                    id="booking-message-body"
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
                                    {isSendingMessage && <Icon className="fas fa-spinner fa-spin" />}
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
