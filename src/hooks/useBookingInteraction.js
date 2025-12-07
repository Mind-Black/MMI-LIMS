import { useState, useRef, useEffect, useCallback } from 'react';
import { timeToMinutes, minutesToTime, roundToNearestSlot, checkCollision } from '../utils/bookingUtils';

const PIXELS_PER_30_MINS = 48;
const START_HOUR = 8;

export const useBookingInteraction = ({
    weekDates,
    existingBookings,
    user,
    isAdmin,
    onInteractionEnd,
    showToast
}) => {
    const [interaction, setInteraction] = useState(null);
    const interactionRef = useRef(null);

    const formatDate = (date) => {
        try {
            return date.toISOString().split('T')[0];
        } catch (e) {
            return '';
        }
    };

    const startInteraction = (e, booking, type) => {
        e.stopPropagation();

        // Permission check
        const isOwnBooking = booking.user_id === user.id;
        if (!isAdmin && !isOwnBooking) {
            showToast('You can only edit your own bookings.', 'error');
            return;
        }

        const now = new Date();
        const bookingStart = new Date(`${booking.date}T${booking.startTime}`);
        const bookingEnd = new Date(`${booking.date}T${booking.endTime}`);

        if (bookingEnd < now) {
            showToast('Cannot modify past bookings.', 'error');
            return;
        }

        const isInProgress = bookingStart <= now && bookingEnd > now;
        if (isInProgress) {
            if (type === 'move') {
                showToast('Cannot move an in-progress booking. Only duration can be adjusted.', 'error');
                return;
            }
            if (type === 'resize-top') {
                showToast('Cannot change start time of an in-progress booking.', 'error');
                return;
            }
        }

        const rect = e.currentTarget.parentElement.getBoundingClientRect();

        // Calculate initial visual properties
        const startHour = parseInt(booking.startTime.split(':')[0]);
        const startMin = parseInt(booking.startTime.split(':')[1]);
        const endHour = parseInt(booking.endTime.split(':')[0]);
        const endMin = parseInt(booking.endTime.split(':')[1]);
        const startOffset = (startHour - START_HOUR) * 60 + startMin;
        const endOffset = (endHour - START_HOUR) * 60 + endMin;
        const duration = endOffset - startOffset;
        const top = (startOffset / 30) * PIXELS_PER_30_MINS;
        const height = (duration / 30) * PIXELS_PER_30_MINS;

        const initialData = {
            type,
            bookingId: booking.ids[0],
            originalBooking: booking,
            startY: e.clientY,
            startX: e.clientX,
            initialTop: top,
            initialHeight: height,
            currentTop: top,
            currentHeight: height,
            currentDate: booking.date,
            dayWidth: rect.width,
            isValid: true, // Initial state is valid
            hasMoved: false
        };

        interactionRef.current = initialData;
        // Don't setInteraction here. Wait for movement threshold.
    };

    useEffect(() => {
        const handleMouseMove = (e) => {
            if (!interactionRef.current) return;

            const data = interactionRef.current;

            // Check threshold if not yet moved
            if (!data.hasMoved) {
                const dist = Math.sqrt(Math.pow(e.clientX - data.startX, 2) + Math.pow(e.clientY - data.startY, 2));
                if (dist < 5) return; // 5px threshold

                data.hasMoved = true;
                setInteraction(data); // Start visual interaction now
            }

            const deltaY = e.clientY - data.startY;
            const deltaX = e.clientX - data.startX;
            // Simplify snapping: round deltaY to nearest 48px (PIXELS_PER_30_MINS)
            const snappedDeltaY = Math.round(deltaY / PIXELS_PER_30_MINS) * PIXELS_PER_30_MINS;

            let dayIndexDelta = 0;
            if (data.type === 'move') {
                dayIndexDelta = Math.round(deltaX / data.dayWidth);
            }

            let newTop = data.initialTop;
            let newHeight = data.initialHeight;
            let newDate = data.currentDate;

            // Visual position (smooth)
            let visualTop = data.initialTop;
            let visualHeight = data.initialHeight;

            if (data.type === 'move') {
                newTop += snappedDeltaY;
                visualTop = newTop; // Snapped movement

                const currentDayIndex = weekDates.findIndex(d => formatDate(d) === data.originalBooking.date);
                const newDayIndex = currentDayIndex + dayIndexDelta;
                if (newDayIndex >= 0 && newDayIndex < 7) {
                    newDate = formatDate(weekDates[newDayIndex]);
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

            if (newHeight < PIXELS_PER_30_MINS) {
                const heightDiff = PIXELS_PER_30_MINS - newHeight;
                newHeight = PIXELS_PER_30_MINS;
                if (data.type === 'resize-top') newTop -= heightDiff;
            }
            // Constrain visual height minimum
            if (visualHeight < PIXELS_PER_30_MINS) {
                const vDiff = PIXELS_PER_30_MINS - visualHeight;
                visualHeight = PIXELS_PER_30_MINS;
                if (data.type === 'resize-top') visualTop -= vDiff;
            }


            // --- Real-time Validation ---
            const startOffsetMins = (newTop / PIXELS_PER_30_MINS) * 30;
            const durationMins = (newHeight / PIXELS_PER_30_MINS) * 30;
            const startTotalMins = roundToNearestSlot((START_HOUR * 60) + startOffsetMins);
            const endTotalMins = roundToNearestSlot(startTotalMins + durationMins);

            const newStartTime = minutesToTime(startTotalMins);
            const newEndTime = minutesToTime(endTotalMins);

            const now = new Date();
            const newStartDateTime = new Date(`${newDate}T${newStartTime}`);
            const isValidTime = startTotalMins >= (8 * 60) && endTotalMins <= (20 * 60);
            const isFuture = newStartDateTime >= now;

            // Check if end time is valid (for shortening active bookings)
            const isActive = new Date(`${data.originalBooking.date}T${data.originalBooking.startTime}`) <= now && new Date(`${data.originalBooking.date}T${data.originalBooking.endTime}`) > now;
            const isEndTimeValid = !isActive || new Date(`${newDate}T${newEndTime}`) > now;

            let isValid = isValidTime && isFuture && isEndTimeValid;

            if (isValid) {
                const tempBooking = {
                    date: newDate,
                    startTime: newStartTime,
                    endTime: newEndTime,
                    tool_id: data.originalBooking.tool_id
                };
                // Ensure we pass all IDs to ignore (handle grouped bookings)
                const ignoredIds = data.originalBooking.ids || [data.originalBooking.id];
                const hasCollision = checkCollision(tempBooking, existingBookings, ignoredIds);

                if (hasCollision) {
                    isValid = false;
                    console.log('Validation failed: Collision detected', { tempBooking, ignoredIds });
                }
            } else {
                console.log('Validation failed:', {
                    isValidTime,
                    isFuture,
                    isEndTimeValid,
                    newDate,
                    newStartTime,
                    now: now.toISOString(),
                    startDateTime: newStartDateTime.toISOString()
                });
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

        const handleMouseUp = () => {
            if (!interactionRef.current) return;

            const data = interactionRef.current;

            if (data.hasMoved && data.isValid) {
                const newBooking = {
                    ...data.originalBooking,
                    date: data.currentDate,
                    startTime: data.newStartTime,
                    endTime: data.newEndTime,
                    // Sync legacy fields if they exist, to ensure UI updates correctly
                    time: data.newStartTime,
                    end_time: data.newEndTime,
                };
                onInteractionEnd(newBooking);
            }

            // If we dragged (hasMoved), delay clearing interaction to prevent the subsequent 'click' event
            // from triggering the edit popup.
            if (data.hasMoved) {
                setTimeout(() => {
                    setInteraction(null);
                    interactionRef.current = null;
                }, 100);
            } else {
                // If we didn't move, it was a click. Clear immediately so the click handler works.
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
    }, [weekDates, existingBookings, onInteractionEnd, showToast]);

    return {
        interaction,
        startInteraction
    };
};
