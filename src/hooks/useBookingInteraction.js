import { useState, useRef, useEffect } from 'react';
import {
    minutesToTime,
    roundToNearestSlot,
    checkCollision,
    formatLocalDate,
    isBookingPast,
    isBookingInProgress,
    getVilniusInstant
} from '../utils/bookingUtils';

const PIXELS_PER_30_MINS = 48;
const START_HOUR = 0;

export const useBookingInteraction = ({
    weekDates,
    existingBookings,
    user,
    isAdmin,
    isAdminOverride,
    onInteractionEnd,
    showToast
}) => {
    const [interaction, setInteraction] = useState(null);
    const interactionRef = useRef(null);

    const startInteraction = (e, booking, type) => {
        e.stopPropagation();

        // Permission check
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

        const rect = e.currentTarget.parentElement.getBoundingClientRect();

        // Calculate initial visual dimensions
        const startParts = (booking.startTime || '00:00').split(':').map(Number);
        const endParts = (booking.endTime || '00:30').split(':').map(Number);
        const startOffset = (startParts[0] - START_HOUR) * 60 + startParts[1];
        const endOffset = (endParts[0] - START_HOUR) * 60 + endParts[1];
        const duration = Math.max(30, endOffset - startOffset);
        const top = (startOffset / 30) * PIXELS_PER_30_MINS;
        const height = (duration / 30) * PIXELS_PER_30_MINS;

        const clientX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
        const clientY = e.type.includes('touch') ? e.touches[0].clientY : e.clientY;

        const initialData = {
            type,
            bookingId: Array.isArray(booking.ids) ? booking.ids[0] : booking.id,
            originalBooking: booking,
            startY: clientY,
            startX: clientX,
            initialTop: top,
            initialHeight: height,
            currentTop: top,
            currentHeight: height,
            currentDate: booking.date,
            dayWidth: rect.width || 120,
            isValid: true,
            hasMoved: false
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
                if (dist < 5) return;
                data.hasMoved = true;
                setInteraction(data);
            }

            const deltaY = clientY - data.startY;
            const deltaX = clientX - data.startX;
            const snappedDeltaY = Math.round(deltaY / PIXELS_PER_30_MINS) * PIXELS_PER_30_MINS;

            let dayIndexDelta = 0;
            if (data.type === 'move' && data.dayWidth > 0) {
                dayIndexDelta = Math.round(deltaX / data.dayWidth);
            }

            let newTop = data.initialTop;
            let newHeight = data.initialHeight;
            let newDate = data.currentDate;

            let visualTop = data.initialTop;
            let visualHeight = data.initialHeight;

            if (data.type === 'move') {
                newTop += snappedDeltaY;
                visualTop = newTop;

                const currentDayIndex = weekDates.findIndex(d => formatLocalDate(d) === data.originalBooking.date);
                const newDayIndex = Math.max(0, Math.min(6, (currentDayIndex >= 0 ? currentDayIndex : 0) + dayIndexDelta));
                if (weekDates[newDayIndex]) {
                    newDate = formatLocalDate(weekDates[newDayIndex]);
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

            // Minimum height constraint
            if (newHeight < PIXELS_PER_30_MINS) {
                const heightDiff = PIXELS_PER_30_MINS - newHeight;
                newHeight = PIXELS_PER_30_MINS;
                if (data.type === 'resize-top') newTop -= heightDiff;
            }
            if (visualHeight < PIXELS_PER_30_MINS) {
                const vDiff = PIXELS_PER_30_MINS - visualHeight;
                visualHeight = PIXELS_PER_30_MINS;
                if (data.type === 'resize-top') visualTop -= vDiff;
            }

            // Validation with safe clamping (prevents negative offsets or > 24:00 times)
            const rawStartMins = (newTop / PIXELS_PER_30_MINS) * 30;
            const rawDurationMins = (newHeight / PIXELS_PER_30_MINS) * 30;

            const startTotalMins = roundToNearestSlot((START_HOUR * 60) + rawStartMins);
            const endTotalMins = roundToNearestSlot(startTotalMins + rawDurationMins);

            // Bounds check: must be within [00:00, 24:00]
            const isValidTime = startTotalMins >= 0 && endTotalMins <= 1440 && endTotalMins > startTotalMins;

            const clampedStartMins = Math.max(0, Math.min(1410, startTotalMins));
            const clampedEndMins = Math.max(clampedStartMins + 30, Math.min(1440, endTotalMins));

            const newStartTime = minutesToTime(clampedStartMins);
            const newEndTime = minutesToTime(clampedEndMins);

            const now = Date.now();
            const startInstant = getVilniusInstant(newDate, newStartTime);
            const endInstant = getVilniusInstant(newDate, newEndTime);
            const hasValidDates = !isNaN(startInstant) && !isNaN(endInstant);

            // Active booking checks
            const isActive = isBookingInProgress(data.originalBooking);

            const isFuture = isActive || isAdminOverride ? true : (hasValidDates && startInstant >= (now - 5 * 60 * 1000));
            const isEndTimeValid = !isActive || isAdminOverride || (hasValidDates && endInstant > now);

            let isValid = isValidTime && hasValidDates && isFuture && isEndTimeValid;

            if (isValid) {
                const tempBooking = {
                    date: newDate,
                    startTime: newStartTime,
                    endTime: newEndTime,
                    tool_id: data.originalBooking.tool_id
                };
                const ignoredIds = data.originalBooking.ids || [data.originalBooking.id];
                const hasCollision = checkCollision(tempBooking, existingBookings, ignoredIds);
                if (hasCollision) {
                    isValid = false;
                }
            }

            const newData = {
                ...data,
                currentTop: data.type === 'move' || data.type === 'resize-top' ? visualTop : data.initialTop,
                currentHeight: visualHeight,
                currentDate: newDate,
                isValid,
                newStartTime,
                newEndTime
            };

            interactionRef.current = newData;
            setInteraction(newData);
        };

        const handleUp = () => {
            if (!interactionRef.current) return;
            const data = interactionRef.current;

            if (data.hasMoved && data.isValid) {
                const newBooking = {
                    ...data.originalBooking,
                    date: data.currentDate,
                    startTime: data.newStartTime,
                    endTime: data.newEndTime,
                    time: data.newStartTime,
                    end_time: data.newEndTime,
                };
                onInteractionEnd(newBooking);
            }

            if (data.hasMoved) {
                setTimeout(() => {
                    setInteraction(null);
                    interactionRef.current = null;
                }, 100);
            } else {
                setInteraction(null);
                interactionRef.current = null;
            }
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
    }, [weekDates, existingBookings, isAdminOverride, onInteractionEnd, showToast]);

    return {
        interaction,
        startInteraction
    };
};
