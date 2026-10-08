import { useState, useRef, useEffect } from 'react';
import {
    minutesToTime,
    roundToNearestSlot,
    checkCollision,
    formatLocalDate,
    isBookingPast,
    isBookingInProgress,
    getVilniusInstant,
    isSlotInPast
} from '../utils/bookingUtils';

const START_HOUR = 0;

export const useBookingInteraction = ({
    weekDates,
    existingBookings,
    user,
    isAdmin,
    isAdminOverride,
    onInteractionEnd,
    showToast,
    slotHeight = 32
}) => {
    const [interaction, setInteraction] = useState(null);
    const interactionRef = useRef(null);

    const startInteraction = (e, booking, type, targetType = 'existing') => {
        e.stopPropagation();

        if (targetType === 'existing') {
            // Permission check for existing bookings
            const isOwnBooking = booking.user_id === user.id;
            if (!isAdmin && !isOwnBooking) {
                showToast('You can only edit your own bookings.', 'error');
                return;
            }

            if (isBookingPast(booking) && !isAdminOverride) {
                showToast('Cannot modify past bookings.', 'error');
                return;
            }

            const isInProgress = isBookingInProgress(booking);
            if (isInProgress) {
                if (type === 'move') {
                    if (!isAdminOverride) {
                        showToast('Cannot move an in-progress booking. Only duration can be adjusted.', 'error');
                        return;
                    }
                }
                if (type === 'resize-top') {
                    showToast('Cannot change start time of an in-progress booking.', 'error');
                    return;
                }
            }
        }

        // Find day column parent element for width measurement
        const dayCol = e.currentTarget.closest('[data-day-column]') || e.currentTarget.parentElement;
        const rect = dayCol.getBoundingClientRect();

        // Calculate initial visual dimensions using slotHeight
        const startParts = (booking.startTime || '00:00').split(':').map(Number);
        const endParts = (booking.endTime || '00:30').split(':').map(Number);
        const startOffset = (startParts[0] - START_HOUR) * 60 + startParts[1];
        const endOffset = (endParts[0] - START_HOUR) * 60 + endParts[1];
        const duration = Math.max(30, endOffset - startOffset);
        const top = (startOffset / 30) * slotHeight;
        const height = (duration / 30) * slotHeight;

        const clientX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
        const clientY = e.type.includes('touch') ? e.touches[0].clientY : e.clientY;

        const initialData = {
            type,
            targetType, // 'draft' or 'existing'
            bookingId: Array.isArray(booking.ids) ? booking.ids[0] : (booking.id || 'draft'),
            originalBooking: booking,
            startY: clientY,
            startX: clientX,
            initialTop: top,
            initialHeight: height,
            currentTop: top,
            currentHeight: height,
            currentDate: booking.date,
            initialDate: booking.date,
            dayWidth: rect.width || 120,
            isValid: true,
            invalidReason: '',
            hasMoved: false,
            newStartTime: booking.startTime,
            newEndTime: booking.endTime
        };

        interactionRef.current = initialData;

        if (e.type.includes('touch')) {
            setInteraction(initialData);
        }
    };

    useEffect(() => {
        const handleMove = (e) => {
            if (!interactionRef.current) return;
            const data = interactionRef.current;

            let clientX, clientY;
            if (e.type === 'touchmove') {
                if (e.cancelable) e.preventDefault();
                clientX = e.touches[0].clientX;
                clientY = e.touches[0].clientY;
            } else {
                clientX = e.clientX;
                clientY = e.clientY;
            }

            if (!data.hasMoved) {
                const dist = Math.hypot(clientX - data.startX, clientY - data.startY);
                if (dist < 4) return;
                data.hasMoved = true;
                setInteraction(data);
            }

            const deltaY = clientY - data.startY;
            const deltaX = clientX - data.startX;
            const snappedDeltaY = Math.round(deltaY / slotHeight) * slotHeight;

            let newTop = data.initialTop;
            let newHeight = data.initialHeight;
            let newDate = data.initialDate;

            let visualTop = data.initialTop;
            let visualHeight = data.initialHeight;

            if (data.type === 'move') {
                newTop += snappedDeltaY;
                visualTop = newTop;

                // Determine target day: check hovered day column first, fallback to deltaX
                let hoveredDate = null;
                const hoveredEl = document.elementFromPoint(clientX, clientY);
                const col = hoveredEl?.closest('[data-day-column]');
                if (col && col.dataset?.date) {
                    hoveredDate = col.dataset.date;
                }

                if (hoveredDate) {
                    newDate = hoveredDate;
                } else if (data.dayWidth > 0) {
                    const dayIndexDelta = Math.round(deltaX / data.dayWidth);
                    const currentDayIndex = weekDates.findIndex(d => formatLocalDate(d) === data.initialDate);
                    const newDayIndex = Math.max(0, Math.min(6, (currentDayIndex >= 0 ? currentDayIndex : 0) + dayIndexDelta));
                    if (weekDates[newDayIndex]) {
                        newDate = formatLocalDate(weekDates[newDayIndex]);
                    }
                }
            } else if (data.type === 'resize-bottom') {
                newHeight += snappedDeltaY;
                visualHeight = newHeight;
            } else if (data.type === 'resize-top') {
                newTop += snappedDeltaY;
                newHeight -= snappedDeltaY;
                visualTop = newTop;
                visualHeight = newHeight;
            }

            // Minimum height constraint (at least 1 slot = slotHeight)
            if (newHeight < slotHeight) {
                const heightDiff = slotHeight - newHeight;
                newHeight = slotHeight;
                if (data.type === 'resize-top') newTop -= heightDiff;
            }
            if (visualHeight < slotHeight) {
                const vDiff = slotHeight - visualHeight;
                visualHeight = slotHeight;
                if (data.type === 'resize-top') visualTop -= vDiff;
            }

            // Validation with safe conversion to minutes
            const rawStartMins = (newTop / slotHeight) * 30;
            const rawDurationMins = (newHeight / slotHeight) * 30;

            const startTotalMins = roundToNearestSlot((START_HOUR * 60) + rawStartMins);
            const endTotalMins = roundToNearestSlot(startTotalMins + rawDurationMins);

            let isValid = true;
            let invalidReason = '';

            // Bounds check: must be within [00:00, 24:00]
            if (startTotalMins < 0 || endTotalMins > 1440 || endTotalMins <= startTotalMins) {
                isValid = false;
                invalidReason = 'Reservation must be within lab operating hours (00:00–24:00).';
            }

            const clampedStartMins = Math.max(0, Math.min(1410, startTotalMins));
            const clampedEndMins = Math.max(clampedStartMins + 30, Math.min(1440, endTotalMins));

            const newStartTime = minutesToTime(clampedStartMins);
            const newEndTime = minutesToTime(clampedEndMins);

            const now = Date.now();
            const startInstant = getVilniusInstant(newDate, newStartTime);
            const endInstant = getVilniusInstant(newDate, newEndTime);
            const hasValidDates = !isNaN(startInstant) && !isNaN(endInstant);

            if (isValid && !hasValidDates) {
                isValid = false;
                invalidReason = 'Invalid date or time selected.';
            }

            // Check if slot is in the past
            const isActive = data.targetType === 'existing' && isBookingInProgress(data.originalBooking);
            if (isValid && !isActive && !isAdminOverride) {
                if (isSlotInPast(newDate, newStartTime)) {
                    isValid = false;
                    invalidReason = 'Cannot move reservation into the past.';
                }
            }

            if (isValid && isActive && !isAdminOverride && endInstant <= now) {
                isValid = false;
                invalidReason = 'End time must be in the future.';
            }

            // Check collision against other bookings
            if (isValid) {
                const tempBooking = {
                    date: newDate,
                    startTime: newStartTime,
                    endTime: newEndTime,
                    tool_id: data.originalBooking.tool_id
                };
                const ignoredIds = data.targetType === 'existing'
                    ? (data.originalBooking.ids || [data.originalBooking.id])
                    : [];
                const hasCollision = checkCollision(tempBooking, existingBookings, ignoredIds);
                if (hasCollision) {
                    isValid = false;
                    invalidReason = 'Time slot overlaps an existing reservation.';
                }
            }

            const newData = {
                ...data,
                currentTop: data.type === 'move' || data.type === 'resize-top' ? visualTop : data.initialTop,
                currentHeight: visualHeight,
                currentDate: newDate,
                isValid,
                invalidReason,
                newStartTime,
                newEndTime
            };

            interactionRef.current = newData;
            setInteraction(newData);
        };

        const handleUp = () => {
            if (!interactionRef.current) return;
            const data = interactionRef.current;

            if (data.hasMoved) {
                if (data.isValid) {
                    const updatedBooking = {
                        ...data.originalBooking,
                        date: data.currentDate,
                        startTime: data.newStartTime,
                        endTime: data.newEndTime,
                        time: data.newStartTime,
                        end_time: data.newEndTime,
                        targetType: data.targetType
                    };
                    onInteractionEnd(updatedBooking);
                } else {
                    // Illegal move: snap back! Show toast with reason
                    if (data.invalidReason) {
                        showToast(data.invalidReason, 'error');
                    }
                }
            }

            setTimeout(() => {
                setInteraction(null);
                interactionRef.current = null;
            }, 60);
        };

        window.addEventListener('mousemove', handleMove);
        window.addEventListener('mouseup', handleUp);
        window.addEventListener('touchmove', handleMove, { passive: false });
        window.addEventListener('touchend', handleUp);

        return () => {
            window.removeEventListener('mousemove', handleMove);
            window.removeEventListener('mouseup', handleUp);
            window.removeEventListener('touchmove', handleMove);
            window.removeEventListener('touchend', handleUp);
        };
    }, [weekDates, existingBookings, isAdminOverride, onInteractionEnd, showToast, slotHeight]);

    return {
        interaction,
        startInteraction
    };
};
