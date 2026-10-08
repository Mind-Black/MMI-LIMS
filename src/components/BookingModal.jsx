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

const PIXELS_PER_30_MINS = 32; // Calibrated so full working day (08:00–18:00/20:00) fits on screen
const START_HOUR = 0;
const TOTAL_GRID_HEIGHT = 48 * PIXELS_PER_30_MINS; // 1536px (48 slots * 32px)

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

    // Auto-scroll to 8 AM on mount so full working day (08:00-18:00) fits on screen
    useEffect(() => {
        if (scrollContainerRef.current) {
            let targetHour = 8;
            let targetMin = 0;

            if (initialBooking) {
                const timeStr = initialBooking.time || initialBooking.startTime;
                if (timeStr) {
                    const [h, m] = timeStr.split(':').map(Number);
                    targetHour = Math.min(8, h);
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
        if (!timeStr) return 0;
        const [h, m] = timeStr.split(':').map(Number);
        return (h * 60) + m;
    };

    const allKnownBookings = useMemo(() => {
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

    // Mobile slot tap handler
    const handleSlotTap = (time) => {
        if (!canBook) {
            setFormError(eligibility.reason || 'Booking is restricted.');
            return;
        }
        const nextSlot = getNextSlotTime(time);
        const isBooked = isSlotBooked(formDate, time);
        const isPast = !isAdminOverride && isSlotInPast(formDate, time, currentTime);
        if (isBooked || isPast) return;

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

    // Group bookings for display
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

    // Unified interaction hook for both draft selection and existing bookings
    const { interaction, startInteraction } = useBookingInteraction({
        weekDates,
        existingBookings: displayBookings,
        user,
        isAdmin,
        isAdminOverride,
        slotHeight: PIXELS_PER_30_MINS,
        onInteractionEnd: (updated) => {
            if (updated.targetType === 'draft') {
                const startM = getMinutes(updated.startTime);
                const endM = getMinutes(updated.endTime);
                const slots = [];
                for (let m = startM; m < endM; m += 30) {
                    const t = timeSlots[m / 30];
                    if (t) slots.push({ date: updated.date, time: t });
                }
                setSelectedSlots(slots);
                setFormDate(updated.date);
                setFormStart(updated.startTime);
                setFormEnd(updated.endTime);
                setFormNeedsCheck(false);
                setFormError('');
            } else {
                setEditingBooking(updated);
                setFormDate(updated.date);
                setFormStart(updated.startTime);
                setFormEnd(updated.endTime);
                setFormNeedsCheck(false);
            }
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

    // Single-day constraint during initial drag-to-select
    const updateSelectedSlots = useCallback((sel) => {
        const d = sel.startDIndex;
        const dStr = formatLocalDate(weekDates[d]);
        if (!dStr) return;

        const startIndex = sel.startTIndex;
        const currentIndex = sel.currentTIndex;
        const newSlots = [];

        if (currentIndex >= startIndex) {
            for (let t = startIndex; t <= currentIndex; t++) {
                const tStr = timeSlots[t];
                if (!tStr) continue;
                if (isSlotBooked(dStr, tStr) || (!isAdminOverride && pastSlots.has(`${dStr}:${tStr}`))) {
                    break;
                }
                newSlots.push({ date: dStr, time: tStr });
            }
        } else {
            for (let t = startIndex; t >= currentIndex; t--) {
                const tStr = timeSlots[t];
                if (!tStr) continue;
                if (isSlotBooked(dStr, tStr) || (!isAdminOverride && pastSlots.has(`${dStr}:${tStr}`))) {
                    break;
                }
                newSlots.unshift({ date: dStr, time: tStr });
            }
        }

        setSelectedSlots(newSlots);
        if (newSlots.length > 0) {
            setFormDate(newSlots[0].date);
            setFormStart(newSlots[0].time);
            setFormEnd(getNextSlotTime(newSlots[newSlots.length - 1].time));
        }
    }, [weekDates, timeSlots, isAdminOverride, isSlotBooked, pastSlots]);

    const handleGridMouseDown = (dateStr, timeIndex) => {
        setEditingBooking(null);
        if (!canBook || !availabilityReady) return;

        const timeStr = timeSlots[timeIndex];
        if (isSlotBooked(dateStr, timeStr)) return;
        if (isSlotInPast(dateStr, timeStr, currentTime) && !isAdminOverride) {
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
            // Restrict initial drag to same day
            const dIndex = selectionRef.current.startDIndex;
            selectionRef.current.currentDIndex = dIndex;
            selectionRef.current.currentTIndex = timeIndex;
            updateSelectedSlots(selectionRef.current);
        }
    };

    // Mouse and Touch selection handling
    useEffect(() => {
        if (!isSelecting) return;

        const handleWindowMouseMove = (e) => {
            const element = document.elementFromPoint(e.clientX, e.clientY);
            const cell = element?.closest('[data-timeindex]');
            if (cell && cell.dataset.timeindex !== undefined && selectionRef.current) {
                const timeIndex = parseInt(cell.dataset.timeindex, 10);
                if (timeIndex !== selectionRef.current.currentTIndex) {
                    selectionRef.current.currentTIndex = timeIndex;
                    updateSelectedSlots(selectionRef.current);
                }
            }
        };

        const handleWindowTouchMove = (e) => {
            if (e.cancelable) e.preventDefault();

            const touch = e.touches[0];
            const element = document.elementFromPoint(touch.clientX, touch.clientY);
            const cell = element?.closest('[data-timeindex]');

            if (cell && cell.dataset.timeindex !== undefined && selectionRef.current) {
                const timeIndex = parseInt(cell.dataset.timeindex, 10);
                if (timeIndex !== selectionRef.current.currentTIndex) {
                    selectionRef.current.currentTIndex = timeIndex;
                    updateSelectedSlots(selectionRef.current);
                }
            }
        };

        const handleSelectionEnd = () => {
            setIsSelecting(false);
            selectionRef.current = null;
        };

        window.addEventListener('mousemove', handleWindowMouseMove);
        window.addEventListener('touchmove', handleWindowTouchMove, { passive: false });
        window.addEventListener('mouseup', handleSelectionEnd);
        window.addEventListener('touchend', handleSelectionEnd);

        return () => {
            window.removeEventListener('mousemove', handleWindowMouseMove);
            window.removeEventListener('touchmove', handleWindowTouchMove);
            window.removeEventListener('mouseup', handleSelectionEnd);
            window.removeEventListener('touchend', handleSelectionEnd);
        };
    }, [isSelecting, updateSelectedSlots]);

    // Week navigation
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

    // Keyboard shortcuts
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
            if (isSlotInPast(dateStr, timeStr, currentTime) && !isAdminOverride) {
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
            startInteraction(e, booking, type, 'existing');
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

    // Mutation with draft preservation
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
            <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="booking-dialog-title" tabIndex={-1}
                className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-7xl h-[96vh] md:h-[95vh] flex flex-col overflow-hidden border dark:border-gray-700 transition-colors"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header Bar */}
                <div className="px-4 py-3 border-b dark:border-gray-700 flex justify-between items-center gap-3 bg-white dark:bg-gray-800 shrink-0 z-30 transition-colors">
                    <div className="flex flex-wrap items-center gap-2 min-w-0">
                        <h2 id="booking-dialog-title" className="text-base sm:text-lg font-bold text-gray-800 dark:text-gray-100 truncate">
                            Book {tool.name}
                        </h2>
                        <StatusBadge status={tool.status} />
                        {isAdmin && (tool.status !== 'up' || (tool.license_req && eligibility.level === TOOL_ACCESS_LEVELS.NONE)) && (
                            <span className="text-[11px] text-amber-800 dark:text-amber-200 bg-amber-100 dark:bg-amber-900/40 px-2 py-0.5 rounded font-medium">Admin override</span>
                        )}
                        {isAdminOverride && <span className="text-[11px] text-amber-800 dark:text-amber-200 bg-amber-100 dark:bg-amber-900/40 px-2 py-0.5 rounded font-medium">Past-time override</span>}
                        {eligibility.level === TOOL_ACCESS_LEVELS.LEVEL_2 && (
                            <span className="text-[11px] text-blue-800 dark:text-blue-200 bg-blue-100 dark:bg-blue-900/40 px-2 py-0.5 rounded font-medium flex items-center gap-1">
                                <Icon className="fas fa-user-check text-[10px]" /> Level II
                            </span>
                        )}
                        {eligibility.level === TOOL_ACCESS_LEVELS.LEVEL_1 && (
                            <span className="text-[11px] text-amber-800 dark:text-amber-200 bg-amber-100 dark:bg-amber-900/40 px-2 py-0.5 rounded font-medium flex items-center gap-1">
                                <Icon className="fas fa-user-graduate text-[10px]" /> Level I (In Training)
                            </span>
                        )}
                        {!canBook && eligibility.level !== TOOL_ACCESS_LEVELS.LEVEL_1 && (
                            <span className="bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 text-[11px] px-2 py-0.5 rounded font-medium">
                                {eligibility.reason || 'Booking Restricted'}
                            </span>
                        )}
                    </div>

                    <button onClick={onClose} aria-label="Close booking dialog" className="btn-icon text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 shrink-0">
                        <Icon aria-hidden="true" className="fas fa-times text-base" />
                    </button>
                </div>

                {/* Main Body: Left Sidebar + Right Calendar Area */}
                <div className="flex-1 flex flex-col md:flex-row min-h-0 overflow-hidden">
                    {/* Left Sidebar */}
                    <div className="w-full md:w-80 lg:w-96 shrink-0 border-r dark:border-gray-700 bg-gray-50 dark:bg-gray-900 flex flex-col justify-between overflow-y-auto">
                        <div className="p-4 space-y-3.5 flex-1 overflow-y-auto">
                            {/* Tool Metadata Card */}
                            <div className="bg-white dark:bg-gray-800 p-2.5 rounded-lg border dark:border-gray-700 text-xs text-gray-600 dark:text-gray-300 space-y-1 shadow-2xs">
                                <div className="flex items-center justify-between">
                                    <span className="font-semibold text-gray-800 dark:text-gray-100">{tool.category}</span>
                                    <span className="text-[11px] text-gray-500 dark:text-gray-400">{tool.location || 'Lab'}</span>
                                </div>
                                <div className="text-[11px] text-gray-500 dark:text-gray-400 flex items-center gap-1 truncate">
                                    <Icon className="fas fa-user-shield text-[10px] text-gray-400" />
                                    <span className="truncate">Responsible: <span className="font-medium text-gray-700 dark:text-gray-200">{tool.primary_responsible ? `${tool.primary_responsible.first_name || ''} ${tool.primary_responsible.last_name || ''}`.trim() : 'Lab Administrator'}</span></span>
                                </div>
                                <div className="text-[10px] text-blue-700 dark:text-blue-300 flex items-center gap-1 font-mono">
                                    <Icon className="fas fa-globe-europe text-[9px]" />
                                    <span>Lab Time: {vilniusNow.timeStr} (Europe/Vilnius)</span>
                                </div>
                            </div>

                            {/* Level Notice Banners */}
                            {eligibility.level === TOOL_ACCESS_LEVELS.LEVEL_2 && (
                                <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800/40 rounded-lg p-2.5 text-xs text-blue-800 dark:text-blue-200 flex items-start gap-2">
                                    <Icon className="fas fa-info-circle text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
                                    <span><strong>Level II:</strong> Reservations are submitted for confirmation by Tool Responsible.</span>
                                </div>
                            )}
                            {eligibility.level === TOOL_ACCESS_LEVELS.LEVEL_1 && (
                                <div className="bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800/40 rounded-lg p-2.5 text-xs text-amber-800 dark:text-amber-200 flex items-start gap-2">
                                    <Icon className="fas fa-user-graduate text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                                    <span><strong>Level I (In Training):</strong> Booking restricted until training completed.</span>
                                </div>
                            )}

                            {/* Booking Parameters Form */}
                            <div className="space-y-2.5">
                                <div className="flex items-center justify-between">
                                    <h3 className="font-bold text-gray-800 dark:text-gray-100 text-xs uppercase tracking-wider">Booking Details</h3>
                                    {selectedSlots.length > 0 && !editingBooking && (
                                        <button
                                            type="button"
                                            onClick={() => setSelectedSlots([])}
                                            className="text-xs text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                                        >
                                            Clear
                                        </button>
                                    )}
                                </div>

                                {/* Date Selector */}
                                <div>
                                    <label className="text-[11px] font-semibold text-gray-600 dark:text-gray-400 block mb-1">Date</label>
                                    <div className="flex items-center gap-1">
                                        <button
                                            type="button"
                                            onClick={handlePrevDay}
                                            className="p-1.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 shrink-0 cursor-pointer min-h-[32px] min-w-[30px] flex items-center justify-center text-xs"
                                            title="Previous Day"
                                        >
                                            <Icon className="fas fa-chevron-left text-[9px]" />
                                        </button>
                                        <input
                                            type="date"
                                            className="input-field flex-1 text-xs py-1 min-h-[32px]"
                                            value={formDate}
                                            onChange={e => handleFormDateChange(e.target.value)}
                                        />
                                        <button
                                            type="button"
                                            onClick={handleNextDay}
                                            className="p-1.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 shrink-0 cursor-pointer min-h-[32px] min-w-[30px] flex items-center justify-center text-xs"
                                            title="Next Day"
                                        >
                                            <Icon className="fas fa-chevron-right text-[9px]" />
                                        </button>
                                    </div>
                                </div>

                                {/* Start & End Time Selectors */}
                                <div className="grid grid-cols-2 gap-2">
                                    <div>
                                        <label className="text-[11px] font-semibold text-gray-600 dark:text-gray-400 block mb-1">Start</label>
                                        <select
                                            className="select-input w-full text-xs min-h-[32px] py-1"
                                            value={formStart}
                                            onChange={e => { setFormStart(e.target.value); setFormError(''); setFormNeedsCheck(true); setSelectedSlots([]); }}
                                        >
                                            {timeSlots.map(time => <option key={time} value={time}>{time}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="text-[11px] font-semibold text-gray-600 dark:text-gray-400 block mb-1">End</label>
                                        <select
                                            className="select-input w-full text-xs min-h-[32px] py-1"
                                            value={formEnd}
                                            onChange={e => { setFormEnd(e.target.value); setFormError(''); setFormNeedsCheck(true); setSelectedSlots([]); }}
                                        >
                                            {[...timeSlots.slice(1), '24:00'].map(time => <option key={time} value={time}>{time}</option>)}
                                        </select>
                                    </div>
                                </div>

                                {/* Quick Duration Presets */}
                                <div>
                                    <div className="flex items-center justify-between mb-1">
                                        <span className="text-[11px] font-semibold text-gray-600 dark:text-gray-400">Quick Duration</span>
                                    </div>
                                    <div className="grid grid-cols-6 gap-1">
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
                                                className="px-1 py-1 text-[11px] font-medium rounded bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-blue-50 dark:hover:bg-blue-900/30 hover:border-blue-300 transition-colors shadow-2xs text-center cursor-pointer"
                                            >
                                                +{d.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Project Selector */}
                                <div>
                                    <label className="text-[11px] font-semibold text-gray-600 dark:text-gray-400 block mb-1">Project</label>
                                    <select
                                        value={selectedProject}
                                        onChange={e => setSelectedProject(e.target.value)}
                                        className="select-input w-full text-xs min-h-[32px] py-1"
                                    >
                                        <option value="General">General</option>
                                        {profile?.projects?.map(proj => <option key={proj} value={proj}>{proj}</option>)}
                                    </select>
                                </div>

                                <button
                                    type="button"
                                    onClick={applyFormSelection}
                                    disabled={!canBook || !availabilityReady}
                                    className="btn btn-secondary w-full text-xs py-1.5 min-h-[32px]"
                                >
                                    Check & Apply Time
                                </button>

                                <div role="status" aria-live="polite" className="text-[11px] text-gray-600 dark:text-gray-300">
                                    {availability.key !== availabilityKey || availability.state === 'loading'
                                        ? 'Checking availability…'
                                        : availability.state === 'error'
                                            ? availability.message
                                            : 'Availability synced.'}
                                    {availability.state === 'error' && (
                                        <button type="button" onClick={fetchToolWeekBookings} className="ml-1 underline text-blue-600 dark:text-blue-400 cursor-pointer">Retry</button>
                                    )}
                                </div>
                                {formError && <p role="alert" className="text-xs text-red-600 dark:text-red-400 font-semibold">{formError}</p>}
                                {formNeedsCheck && <p className="text-xs text-amber-600 dark:text-amber-400">Click &apos;Check & Apply Time&apos; to confirm manual changes.</p>}
                            </div>

                            {/* Active Selection / Reservation Card */}
                            {selectedSlots.length > 0 && !editingBooking && (
                                <div className="bg-blue-50 dark:bg-blue-950/60 border border-blue-300 dark:border-blue-700/80 rounded-lg p-2.5 text-xs text-blue-950 dark:text-blue-100 shadow-2xs space-y-1">
                                    <div className="flex items-center justify-between">
                                        <span className="font-bold flex items-center gap-1.5 text-blue-900 dark:text-blue-200">
                                            <Icon className="fas fa-check-circle text-blue-600 dark:text-blue-400 text-xs" />
                                            Selected Range
                                        </span>
                                        <span className="font-bold text-[11px] bg-blue-200/60 dark:bg-blue-800/60 px-1.5 py-0.5 rounded">
                                            {Math.floor((selectedSlots.length * 30) / 60)}h {(selectedSlots.length * 30) % 60 ? `${(selectedSlots.length * 30) % 60}m` : ''}
                                        </span>
                                    </div>
                                    <div className="font-mono text-xs">
                                        {selectedSlots[0].date}, {selectedSlots[0].time}–{getNextSlotTime(selectedSlots[selectedSlots.length - 1].time)}
                                    </div>
                                    <div className="text-[11px] text-blue-800 dark:text-blue-300 opacity-90">
                                        Project: {selectedProject}
                                    </div>
                                </div>
                            )}

                            {editingBooking && (
                                <div className="bg-amber-50 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-700/80 rounded-lg p-2.5 text-xs text-amber-950 dark:text-amber-100 shadow-2xs space-y-1">
                                    <div className="flex items-center justify-between">
                                        <span className="font-bold flex items-center gap-1.5 text-amber-900 dark:text-amber-200">
                                            <Icon className="fas fa-edit text-amber-600 dark:text-amber-400 text-xs" />
                                            Editing Reservation
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => { setEditingBooking(null); setOriginalBookingState(null); }}
                                            className="text-[11px] underline text-amber-700 dark:text-amber-300 cursor-pointer"
                                        >
                                            Reset
                                        </button>
                                    </div>
                                    <div className="font-mono text-xs">
                                        {editingBooking.date}, {editingBooking.startTime}–{editingBooking.endTime}
                                    </div>
                                    <div className="text-[11px] text-amber-800 dark:text-amber-300 opacity-90">
                                        Project: {selectedProject}
                                    </div>
                                </div>
                            )}

                            {/* Interaction Tips Box */}
                            <div className="bg-white dark:bg-gray-800 p-2.5 rounded-lg border dark:border-gray-700 text-[11px] text-gray-500 dark:text-gray-400 space-y-1">
                                <div className="font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1">
                                    <Icon className="fas fa-lightbulb text-amber-500 text-[10px]" />
                                    <span>Interactive Tips</span>
                                </div>
                                <ul className="list-disc list-inside space-y-0.5 text-[10px] leading-relaxed">
                                    <li>Click or drag on empty grid to select a slot.</li>
                                    <li>Drag the blue window to move across hours or days.</li>
                                    <li>Drag top or bottom edges (↕) to resize duration.</li>
                                    <li>Illegal moves automatically snap back.</li>
                                </ul>
                            </div>

                            {/* Legend */}
                            <div className="pt-2 border-t dark:border-gray-700 grid grid-cols-2 gap-1 text-[11px] text-gray-500 dark:text-gray-400">
                                <div className="flex items-center gap-1.5"><div className="w-3 h-3 bg-white dark:bg-gray-800 border dark:border-gray-600 rounded"></div> Free</div>
                                <div className="flex items-center gap-1.5"><div className="w-3 h-3 bg-blue-500/30 border border-blue-600 rounded"></div> Selected</div>
                                <div className="flex items-center gap-1.5"><div className="w-3 h-3 bg-blue-100 dark:bg-blue-900/60 border border-blue-300 rounded"></div> Mine</div>
                                <div className="flex items-center gap-1.5"><div className="w-3 h-3 bg-gray-200 dark:bg-gray-700 border border-gray-300 rounded"></div> Booked</div>
                            </div>

                            {/* Mobile Day Availability Timeline (visible only on mobile) */}
                            <div className="md:hidden pt-3 border-t dark:border-gray-700 space-y-2">
                                <div className="text-xs font-bold text-gray-700 dark:text-gray-300 flex items-center justify-between">
                                    <span>Mobile Day Timeline ({formDate})</span>
                                </div>
                                <div className="grid grid-cols-4 gap-1 max-h-48 overflow-y-auto p-1 border dark:border-gray-700 rounded bg-white dark:bg-gray-800">
                                    {timeSlots.map(time => {
                                        const isBooked = isSlotBooked(formDate, time);
                                        const isPast = !isAdminOverride && isSlotInPast(formDate, time, currentTime);
                                        const isSelected = selectedSlotKeys.has(`${formDate}:${time}`);
                                        return (
                                            <button
                                                key={time}
                                                type="button"
                                                disabled={(isBooked && !isSelected) || isPast}
                                                onClick={() => handleSlotTap(time)}
                                                className={`py-1 px-0.5 rounded text-[11px] border text-center transition-all ${
                                                    isSelected ? 'bg-blue-600 text-white font-bold' : isBooked ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : isPast ? 'bg-gray-50 text-gray-300 cursor-not-allowed' : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                                                }`}
                                            >
                                                {time}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>

                        {/* Pinned Bottom Actions in Sidebar */}
                        <div className="p-3 border-t dark:border-gray-700 bg-white dark:bg-gray-800 shrink-0 space-y-2">
                            <div className="flex items-center gap-2">
                                <button onClick={onClose} className="btn btn-secondary flex-1 text-xs py-2">
                                    Cancel
                                </button>
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
                                    className={`btn flex-1 text-xs py-2 flex items-center justify-center gap-1.5
                                        ${(editingBooking && editingBooking.user_id !== user.id && (!isAdmin || !isBookingDirty))
                                            ? 'bg-blue-100 text-blue-700 hover:bg-blue-200 dark:bg-blue-900/50 dark:text-blue-300 dark:hover:bg-blue-900/70'
                                            : ((selectedSlots.length === 0 && !editingBooking) || isSubmitting
                                                ? 'bg-gray-300 cursor-not-allowed text-white'
                                                : 'btn-primary')
                                        }`}
                                >
                                    {(editingBooking && editingBooking.user_id !== user.id && (!isAdmin || !isBookingDirty)) ? (
                                        <>
                                            <Icon className="fas fa-envelope text-xs" /> Message
                                        </>
                                    ) : (
                                        <>
                                            {isSubmitting && <Icon className="fas fa-spinner fa-spin text-xs" />}
                                            {isSubmitting ? (editingBooking ? 'Updating...' : 'Booking...') : (editingBooking ? 'Update' : 'Confirm')}
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Right Calendar Area (Desktop) */}
                    <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-white dark:bg-gray-800">
                        {/* Week Navigation Toolbar */}
                        <div className="px-4 py-2 border-b dark:border-gray-700 flex items-center justify-between gap-2 bg-white dark:bg-gray-800 shrink-0 z-20">
                            <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-700 p-0.5 rounded-lg">
                                <button onClick={handlePrevWeek} className="btn-icon text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-600 p-1" title="Previous Week (Alt+Left)">
                                    <Icon className="fas fa-chevron-left text-xs" />
                                </button>
                                <button onClick={handleToday} className="px-2 py-0.5 text-xs font-semibold text-gray-700 dark:text-gray-200 hover:bg-white dark:hover:bg-gray-600 rounded" title="Jump to today (T)">
                                    Today
                                </button>
                                <button onClick={handleNextWeek} className="btn-icon text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-600 p-1" title="Next Week (Alt+Right)">
                                    <Icon className="fas fa-chevron-right text-xs" />
                                </button>
                            </div>

                            <span className="text-xs sm:text-sm font-bold text-gray-800 dark:text-gray-100">
                                {displayDate(weekDates[0])} &ndash; {displayDate(weekDates[6])}
                            </span>

                            {/* Active selection duration indicator badge */}
                            {selectedSlots.length > 0 && !editingBooking && (
                                <div className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-100 dark:bg-blue-900/60 text-blue-900 dark:text-blue-200 text-xs font-medium border border-blue-200 dark:border-blue-700">
                                    <Icon className="fas fa-clock text-[10px] text-blue-600 dark:text-blue-400" />
                                    <span>
                                        {selectedSlots[0].time}–{getNextSlotTime(selectedSlots[selectedSlots.length - 1].time)}
                                        {' '}({Math.floor((selectedSlots.length * 30) / 60)}h {(selectedSlots.length * 30) % 60 ? `${(selectedSlots.length * 30) % 60}m` : ''})
                                    </span>
                                </div>
                            )}
                        </div>

                        {/* Calendar Grid Container */}
                        <div ref={scrollContainerRef} className="hidden md:flex flex-1 overflow-y-auto relative select-none flex-col bg-white dark:bg-gray-800 transition-colors" aria-label="Visual week calendar">
                            {/* Sticky Day Column Headers */}
                            <div className="sticky top-0 z-20 flex border-b dark:border-gray-700 bg-white dark:bg-gray-800 shadow-xs transition-colors">
                                <div className="w-14 shrink-0 border-r dark:border-gray-700 p-1.5 text-center text-[11px] font-bold text-gray-400">
                                    Time
                                </div>
                                <div className="flex-1 grid grid-cols-7">
                                    {weekDates.map((date, idx) => (
                                        <div key={idx} className={`p-1.5 text-center border-r dark:border-gray-700 last:border-0 ${isToday(date) ? 'bg-blue-50/50 dark:bg-blue-900/20' : ''}`}>
                                            <div className="text-[10px] text-gray-500 dark:text-gray-400 uppercase font-semibold">
                                                {date.toLocaleDateString('en-US', { weekday: 'short' })}
                                            </div>
                                            <div className={`text-xs font-bold mt-0.5 ${isToday(date) ? 'text-blue-600 dark:text-blue-400' : 'text-gray-700 dark:text-gray-200'}`}>
                                                {date.getDate()}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Full Height Grid */}
                            <div className="flex flex-1 relative" style={{ minHeight: `${TOTAL_GRID_HEIGHT}px` }}>
                                {/* Time Labels Gutter */}
                                <div className="w-14 shrink-0 border-r dark:border-gray-700 bg-gray-50/50 dark:bg-gray-900/20 select-none">
                                    {timeSlots.map((time, idx) => (
                                        <div
                                            key={idx}
                                            style={{ height: `${PIXELS_PER_30_MINS}px` }}
                                            className="border-b dark:border-gray-700/50 text-[10px] text-gray-400 text-right pr-1.5 pt-0.5 font-mono"
                                        >
                                            {time.endsWith(':00') ? time : ''}
                                        </div>
                                    ))}
                                </div>

                                {/* 7 Day Grid Columns */}
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
                                                data-day-column="true"
                                                data-date={dateStr}
                                                className={`border-r dark:border-gray-700 last:border-0 relative ${isToday(date) ? 'bg-blue-50/10' : ''}`}
                                                style={{ minHeight: `${TOTAL_GRID_HEIGHT}px` }}
                                            >
                                                {/* Current Time Indicator on Today's Column */}
                                                {isToday(date) && (
                                                    <div
                                                        className="absolute left-0 right-0 border-t-2 border-red-500 z-20 pointer-events-none flex items-center"
                                                        style={{ top: `${getCurrentTimeTop()}px` }}
                                                        title={`Lab Time: ${vilniusNow.timeStr}`}
                                                    >
                                                        <div className="w-2 h-2 rounded-full bg-red-500 -ml-1 shadow-xs"></div>
                                                    </div>
                                                )}

                                                <div className="relative" style={{ minHeight: `${TOTAL_GRID_HEIGHT}px` }}>
                                                    {/* Background Grid Cells */}
                                                    {timeSlots.map((time, timeIdx) => {
                                                        const isBooked = isSlotBooked(dateStr, time);
                                                        const isPast = pastSlots.has(`${dateStr}:${time}`);
                                                        const isSelected = selectedSlotKeys.has(`${dateStr}:${time}`);

                                                        return (
                                                            <div
                                                                key={timeIdx}
                                                                data-date={dateStr}
                                                                data-timeindex={timeIdx}
                                                                onMouseDown={() => handleGridMouseDown(dateStr, timeIdx)}
                                                                onMouseEnter={() => handleMouseEnter(dateStr, timeIdx)}
                                                                onTouchStart={(e) => handleGridTouchStart(e, dateStr, timeIdx)}
                                                                onTouchEnd={handleGridTouchEnd}
                                                                style={{ height: `${PIXELS_PER_30_MINS}px` }}
                                                                className={`transition-colors cursor-pointer relative border-b dark:border-gray-700/50 ${
                                                                    time.endsWith(':00') ? 'border-b-gray-200 dark:border-b-gray-700' : 'border-b-gray-100 dark:border-b-gray-800/40'
                                                                } ${
                                                                    isBooked ? 'bg-stripes-gray cursor-not-allowed opacity-40' : ''
                                                                } ${
                                                                    isPast && !isAdminOverride ? 'bg-gray-50/80 dark:bg-gray-800/40 cursor-not-allowed text-gray-300 dark:text-gray-600' : 'hover:bg-blue-50/30 dark:hover:bg-blue-900/10'
                                                                }`}
                                                            >
                                                                {/* Highlight active selection while drawing */}
                                                                {isSelecting && isSelected && (
                                                                    <div className="h-full w-full bg-blue-500/25 border-l-2 border-l-blue-600 pointer-events-none"></div>
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
                                                                className={`absolute border rounded-md p-1 text-xs overflow-hidden transition-all group select-none 
                                                                    ${isPending
                                                                        ? 'bg-amber-100/90 dark:bg-amber-900/40 border-dashed border-amber-400 dark:border-amber-600 text-amber-950 dark:text-amber-100'
                                                                        : isOwnBooking
                                                                            ? 'bg-blue-100 dark:bg-blue-900/60 border-blue-300 dark:border-blue-700'
                                                                            : 'bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600'}
                                                                    ${canEdit ? 'hover:z-15 hover:shadow-md cursor-grab active:cursor-grabbing' : ''}
                                                                    ${editingBooking && editingBooking.id === booking.ids[0] ? 'ring-2 ring-blue-500 z-20' : ''}
                                                                    `}
                                                                style={getEventStyle(booking)}
                                                                onMouseDown={(e) => canMove && startInteraction(e, booking, 'move', 'existing')}
                                                                onTouchStart={(e) => canMove && handleBookingTouchStart(e, booking, 'move')}
                                                                onTouchMove={handleBookingTouchMove}
                                                                onTouchEnd={handleBookingTouchEnd}
                                                                onClick={(e) => handleBookingClick(e, booking)}
                                                                role="button"
                                                                tabIndex={canEdit ? 0 : -1}
                                                                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleBookingClick(e, booking); } }}
                                                                aria-label={`${booking.user_name}, ${booking.project}, ${booking.startTime} to ${booking.endTime}`}
                                                                title={`Booked by: ${booking.user_name}\nProject: ${booking.project}`}
                                                            >
                                                                {canResizeTop && (
                                                                    <div
                                                                        className="absolute top-0 left-0 right-0 h-2 cursor-ns-resize z-25 opacity-0 group-hover:opacity-100 bg-blue-500/40 flex items-center justify-center transition-opacity"
                                                                        title="Drag to resize start time"
                                                                        onMouseDown={(e) => { e.stopPropagation(); startInteraction(e, booking, 'resize-top', 'existing'); }}
                                                                        onTouchStart={(e) => { e.stopPropagation(); handleBookingTouchStart(e, booking, 'resize-top'); }}
                                                                    >
                                                                        <div className="w-6 h-0.5 rounded-full bg-blue-700 dark:bg-blue-200"></div>
                                                                    </div>
                                                                )}

                                                                <div className={`font-bold truncate pointer-events-none flex items-center gap-1 text-[11px] ${isPending ? 'text-amber-900 dark:text-amber-100' : isOwnBooking ? 'text-blue-900 dark:text-blue-100' : 'text-gray-800 dark:text-gray-200'}`}>
                                                                    {isPending && <Icon className="fas fa-clock text-amber-600 text-[9px]" />}
                                                                    <span className="truncate">{booking.user_name}</span>
                                                                    {isPending && <span className="text-[9px] text-amber-700 dark:text-amber-300 font-semibold shrink-0">(Pending)</span>}
                                                                </div>
                                                                <div className={`truncate text-[10px] pointer-events-none ${isPending ? 'text-amber-700 dark:text-amber-300' : isOwnBooking ? 'text-blue-700 dark:text-blue-300' : 'text-gray-600 dark:text-gray-400'}`}>{booking.project}</div>

                                                                {editingBooking && editingBooking.id === booking.ids[0] && (isAdmin || isOwnBooking) && (!isStarted || isAdminOverride) && (
                                                                    <div
                                                                        className="absolute top-0 right-0 p-1 cursor-pointer text-red-600 hover:text-red-800 bg-white/70 hover:bg-white rounded-bl z-30"
                                                                        onClick={(e) => handleCancelClick(e, booking)}
                                                                        title="Cancel Booking"
                                                                    >
                                                                        <Icon className="fas fa-times text-xs" />
                                                                    </div>
                                                                )}

                                                                {canResizeBottom && (
                                                                    <div
                                                                        className="absolute bottom-0 left-0 right-0 h-2 cursor-ns-resize z-25 opacity-0 group-hover:opacity-100 bg-blue-500/40 flex items-center justify-center transition-opacity"
                                                                        title="Drag to resize end time"
                                                                        onMouseDown={(e) => { e.stopPropagation(); startInteraction(e, booking, 'resize-bottom', 'existing'); }}
                                                                        onTouchStart={(e) => { e.stopPropagation(); handleBookingTouchStart(e, booking, 'resize-bottom'); }}
                                                                    >
                                                                        <div className="w-6 h-0.5 rounded-full bg-blue-700 dark:bg-blue-200"></div>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        );
                                                    })}

                                                    {/* Interactive Draft Selection Window (Box) */}
                                                    {!editingBooking && !isSelecting && selectedSlots.length > 0 && selectedSlots[0].date === dateStr && !interaction && (
                                                        <div
                                                            className="absolute rounded-md border-2 border-blue-600 dark:border-blue-400 bg-blue-500/25 dark:bg-blue-600/35 backdrop-blur-xs text-blue-950 dark:text-blue-100 shadow-md ring-2 ring-blue-500/20 flex flex-col justify-between overflow-hidden group select-none transition-shadow hover:shadow-lg cursor-grab active:cursor-grabbing z-25"
                                                            style={{
                                                                top: `${((getMinutes(formStart || selectedSlots[0].time) - (START_HOUR * 60)) / 30) * PIXELS_PER_30_MINS}px`,
                                                                height: `${(((getMinutes(formEnd || getNextSlotTime(selectedSlots[selectedSlots.length - 1].time)) - getMinutes(formStart || selectedSlots[0].time)) / 30) * PIXELS_PER_30_MINS) - 1}px`,
                                                                left: '2px',
                                                                right: '2px'
                                                            }}
                                                            onMouseDown={(e) => {
                                                                e.stopPropagation();
                                                                const draftObj = {
                                                                    id: 'draft',
                                                                    tool_id: tool.id,
                                                                    date: dateStr,
                                                                    startTime: formStart || selectedSlots[0].time,
                                                                    endTime: formEnd || getNextSlotTime(selectedSlots[selectedSlots.length - 1].time),
                                                                    project: selectedProject,
                                                                    user_name: profile ? `${profile.first_name || ''} ${profile.last_name || ''}`.trim() : user.email
                                                                };
                                                                startInteraction(e, draftObj, 'move', 'draft');
                                                            }}
                                                            onTouchStart={(e) => {
                                                                e.stopPropagation();
                                                                const draftObj = {
                                                                    id: 'draft',
                                                                    tool_id: tool.id,
                                                                    date: dateStr,
                                                                    startTime: formStart || selectedSlots[0].time,
                                                                    endTime: formEnd || getNextSlotTime(selectedSlots[selectedSlots.length - 1].time),
                                                                    project: selectedProject,
                                                                    user_name: profile ? `${profile.first_name || ''} ${profile.last_name || ''}`.trim() : user.email
                                                                };
                                                                startInteraction(e, draftObj, 'move', 'draft');
                                                            }}
                                                        >
                                                            {/* Top Double-Arrow Resize Handle (↕) */}
                                                            <div
                                                                className="h-2 w-full cursor-ns-resize bg-blue-600/30 hover:bg-blue-600 dark:bg-blue-400/40 dark:hover:bg-blue-400 transition-colors flex items-center justify-center shrink-0 z-30 group/top"
                                                                title="Drag up/down to adjust start time"
                                                                onMouseDown={(e) => {
                                                                    e.stopPropagation();
                                                                    const draftObj = {
                                                                        id: 'draft',
                                                                        tool_id: tool.id,
                                                                        date: dateStr,
                                                                        startTime: formStart || selectedSlots[0].time,
                                                                        endTime: formEnd || getNextSlotTime(selectedSlots[selectedSlots.length - 1].time),
                                                                        project: selectedProject,
                                                                        user_name: profile ? `${profile.first_name || ''} ${profile.last_name || ''}`.trim() : user.email
                                                                    };
                                                                    startInteraction(e, draftObj, 'resize-top', 'draft');
                                                                }}
                                                                onTouchStart={(e) => {
                                                                    e.stopPropagation();
                                                                    const draftObj = {
                                                                        id: 'draft',
                                                                        tool_id: tool.id,
                                                                        date: dateStr,
                                                                        startTime: formStart || selectedSlots[0].time,
                                                                        endTime: formEnd || getNextSlotTime(selectedSlots[selectedSlots.length - 1].time),
                                                                        project: selectedProject,
                                                                        user_name: profile ? `${profile.first_name || ''} ${profile.last_name || ''}`.trim() : user.email
                                                                    };
                                                                    startInteraction(e, draftObj, 'resize-top', 'draft');
                                                                }}
                                                            >
                                                                <div className="w-8 h-1 rounded-full bg-blue-700 dark:bg-blue-200 group-hover/top:scale-y-125 transition-transform"></div>
                                                            </div>

                                                            {/* Draft Window Center Content */}
                                                            <div className="flex-1 px-1.5 py-0.5 flex flex-col justify-center min-h-0 pointer-events-none">
                                                                <div className="flex items-center justify-between gap-1">
                                                                    <span className="text-[11px] font-bold text-blue-950 dark:text-blue-100 truncate flex items-center gap-1">
                                                                        <span className="w-1.5 h-1.5 rounded-full bg-blue-600 dark:bg-blue-400 shrink-0 animate-pulse"></span>
                                                                        <span className="truncate">{formStart || selectedSlots[0].time}–{formEnd || getNextSlotTime(selectedSlots[selectedSlots.length - 1].time)}</span>
                                                                    </span>
                                                                    <span className="text-[10px] font-semibold text-blue-900 dark:text-blue-200 shrink-0 opacity-85">
                                                                        {Math.floor((selectedSlots.length * 30) / 60)}h {(selectedSlots.length * 30) % 60 ? `${(selectedSlots.length * 30) % 60}m` : ''}
                                                                    </span>
                                                                </div>
                                                                <div className="text-[10px] text-blue-800 dark:text-blue-200/90 truncate font-medium">
                                                                    Draft &bull; {selectedProject}
                                                                </div>
                                                            </div>

                                                            {/* Bottom Double-Arrow Resize Handle (↕) */}
                                                            <div
                                                                className="h-2 w-full cursor-ns-resize bg-blue-600/30 hover:bg-blue-600 dark:bg-blue-400/40 dark:hover:bg-blue-400 transition-colors flex items-center justify-center shrink-0 z-30 group/bottom"
                                                                title="Drag up/down to adjust end time"
                                                                onMouseDown={(e) => {
                                                                    e.stopPropagation();
                                                                    const draftObj = {
                                                                        id: 'draft',
                                                                        tool_id: tool.id,
                                                                        date: dateStr,
                                                                        startTime: formStart || selectedSlots[0].time,
                                                                        endTime: formEnd || getNextSlotTime(selectedSlots[selectedSlots.length - 1].time),
                                                                        project: selectedProject,
                                                                        user_name: profile ? `${profile.first_name || ''} ${profile.last_name || ''}`.trim() : user.email
                                                                    };
                                                                    startInteraction(e, draftObj, 'resize-bottom', 'draft');
                                                                }}
                                                                onTouchStart={(e) => {
                                                                    e.stopPropagation();
                                                                    const draftObj = {
                                                                        id: 'draft',
                                                                        tool_id: tool.id,
                                                                        date: dateStr,
                                                                        startTime: formStart || selectedSlots[0].time,
                                                                        endTime: formEnd || getNextSlotTime(selectedSlots[selectedSlots.length - 1].time),
                                                                        project: selectedProject,
                                                                        user_name: profile ? `${profile.first_name || ''} ${profile.last_name || ''}`.trim() : user.email
                                                                    };
                                                                    startInteraction(e, draftObj, 'resize-bottom', 'draft');
                                                                }}
                                                            >
                                                                <div className="w-8 h-1 rounded-full bg-blue-700 dark:bg-blue-200 group-hover/bottom:scale-y-125 transition-transform"></div>
                                                            </div>
                                                        </div>
                                                    )}

                                                    {/* Live Interaction Ghost (Valid/Invalid Snap-Back preview) */}
                                                    {isTargetDay && (
                                                        <div
                                                            className={`absolute border-2 rounded-lg p-1.5 text-xs overflow-hidden z-50 pointer-events-none shadow-xl transition-all
                                                                ${interaction.isValid
                                                                    ? 'bg-blue-100/95 dark:bg-blue-900/95 border-blue-600 dark:border-blue-400 text-blue-950 dark:text-blue-100 ring-2 ring-blue-500/30'
                                                                    : 'bg-red-100/95 dark:bg-red-950/95 border-red-600 dark:border-red-400 text-red-950 dark:text-red-100 ring-2 ring-red-500/40 animate-pulse'
                                                                }`}
                                                            style={{
                                                                top: `${interaction.currentTop}px`,
                                                                height: `${interaction.currentHeight - 1}px`,
                                                                left: '2px',
                                                                right: '2px'
                                                            }}
                                                        >
                                                            <div className="flex items-center justify-between gap-1 font-bold">
                                                                <span className="flex items-center gap-1.5 truncate text-[11px]">
                                                                    {interaction.isValid ? (
                                                                        <>
                                                                            <Icon className="fas fa-check-circle text-emerald-600 dark:text-emerald-400 text-xs shrink-0" />
                                                                            <span className="truncate">{interaction.newStartTime} &ndash; {interaction.newEndTime}</span>
                                                                        </>
                                                                    ) : (
                                                                        <>
                                                                            <Icon className="fas fa-exclamation-triangle text-red-600 dark:text-red-400 text-xs shrink-0" />
                                                                            <span className="truncate">{interaction.invalidReason || 'Cannot Place Here'}</span>
                                                                        </>
                                                                    )}
                                                                </span>
                                                                <span className="text-[10px] font-semibold opacity-85 shrink-0">
                                                                    {interaction.currentDate}
                                                                </span>
                                                            </div>
                                                            <div className="text-[10px] truncate mt-0.5 opacity-90">
                                                                {interactingBooking?.user_name || 'Draft Reservation'} &bull; {interactingBooking?.project || selectedProject}
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
                    </div>
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
