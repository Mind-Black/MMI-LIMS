export const timeToMinutes = (timeStr) => {
    const [h, m] = timeStr.split(':').map(Number);
    return (h * 60) + m;
};

export const minutesToTime = (totalMins) => {
    let h = Math.floor(totalMins / 60);
    let m = Math.round(totalMins % 60);
    if (m === 60) { h += 1; m = 0; }
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
};

export const roundToNearestSlot = (minutes, slotSize = 30) => {
    return Math.round(minutes / slotSize) * slotSize;
};

export const getNextSlotTime = (timeStr) => {
    const mins = timeToMinutes(timeStr);
    return minutesToTime(mins + 30);
};

export const groupBookings = (bookings) => {
    if (!bookings.length) return [];

    // Helper to normalize time to HH:MM
    const normalizeTime = (t) => t.slice(0, 5);

    const ranges = [];
    const slots = [];

    bookings.forEach(b => {
        if (b.end_time || b.endTime) {
            ranges.push({
                ...b,
                startTime: normalizeTime(b.time || b.startTime),
                endTime: normalizeTime(b.end_time || b.endTime),
                ids: [b.id]
            });
        } else {
            slots.push(b);
        }
    });

    // Sort slots by Date -> Tool -> Time
    const sortedSlots = [...slots].sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        if (a.tool_id !== b.tool_id) return a.tool_id - b.tool_id;
        return normalizeTime(a.time).localeCompare(normalizeTime(b.time));
    });

    const groupedSlots = [];
    let currentGroup = null;

    sortedSlots.forEach(booking => {
        const normalizedTime = normalizeTime(booking.time);

        if (!currentGroup) {
            currentGroup = {
                ...booking,
                ids: [booking.id],
                endTime: getNextSlotTime(normalizedTime),
                startTime: normalizedTime
            };
            return;
        }

        const isSameDate = booking.date === currentGroup.date;
        const isSameTool = booking.tool_id === currentGroup.tool_id;
        const isSameUser = booking.user_id === currentGroup.user_id;
        const isSameProject = booking.project === currentGroup.project;
        const isSameCreatedAt = booking.created_at === currentGroup.created_at;
        const isContinuous = normalizedTime === currentGroup.endTime;

        if (isSameDate && isSameTool && isSameUser && isSameProject && isSameCreatedAt && isContinuous) {
            currentGroup.ids.push(booking.id);
            currentGroup.endTime = getNextSlotTime(normalizedTime);
        } else {
            groupedSlots.push(currentGroup);
            currentGroup = {
                ...booking,
                ids: [booking.id],
                endTime: getNextSlotTime(normalizedTime),
                startTime: normalizedTime
            };
        }
    });

    if (currentGroup) groupedSlots.push(currentGroup);

    return [...ranges, ...groupedSlots];
};

export const generateSlots = (date, startTime, endTime) => {
    const slots = [];
    let current = startTime;

    // Helper to add 30 mins
    const add30Mins = (t) => {
        const [h, m] = t.split(':').map(Number);
        let nextM = m + 30;
        let nextH = h;
        if (nextM >= 60) {
            nextH++;
            nextM = 0;
        }
        return `${nextH.toString().padStart(2, '0')}:${nextM.toString().padStart(2, '0')}`;
    };

    while (current !== endTime) {
        slots.push({
            date,
            time: current
        });
        current = add30Mins(current);
        // Safety break to prevent infinite loops if endTime is unreachable (e.g. past midnight)
        if (parseInt(current.split(':')[0]) >= 24) break;
    }
    return slots;
};

export const checkCollision = (newBooking, existingBookings, ignoredIds = []) => {
    // Helper to get minutes
    const getMinutes = (timeStr) => {
        const [h, m] = timeStr.split(':').map(Number);
        return (h * 60) + m;
    };

    const newStart = getMinutes(newBooking.startTime || newBooking.time);
    const newEnd = getMinutes(newBooking.endTime || newBooking.end_time);

    return existingBookings.some(b => {
        if (ignoredIds.includes(b.id)) return false;
        if (b.date !== newBooking.date) return false;
        if (b.tool_id !== newBooking.tool_id) return false;

        // Handle existing booking as range or slot
        let bStart, bEnd;
        const endTimeStr = b.endTime || b.end_time;

        if (endTimeStr) {
            // It's a range
            bStart = getMinutes(b.startTime || b.time);
            bEnd = getMinutes(endTimeStr);
        } else {
            // It's a slot (old format)
            bStart = getMinutes(b.time);
            bEnd = bStart + 30;
        }

        // Check overlap
        return (newStart < bEnd && newEnd > bStart);
    });
};

export const calculateEventLayout = (bookings) => {
    if (!bookings.length) return [];

    // Helper to get minutes from start of day (08:00)
    const getMinutes = (timeStr) => {
        const [h, m] = timeStr.split(':').map(Number);
        return (h * 60) + m;
    };

    // Sort by start time, then duration (longer first)
    const sorted = [...bookings].sort((a, b) => {
        const startA = getMinutes(a.startTime);
        const startB = getMinutes(b.startTime);
        if (startA !== startB) return startA - startB;

        const endA = getMinutes(a.endTime);
        const endB = getMinutes(b.endTime);
        return (endB - endA); // Longer first
    });

    const columns = [];

    sorted.forEach(booking => {
        const start = getMinutes(booking.startTime);
        const end = getMinutes(booking.endTime);

        // Find first column where this booking fits
        let placed = false;
        for (let i = 0; i < columns.length; i++) {
            const lastInCol = columns[i][columns[i].length - 1];
            const lastEnd = getMinutes(lastInCol.endTime);

            if (start >= lastEnd) {
                columns[i].push(booking);
                booking.colIndex = i;
                placed = true;
                break;
            }
        }

        if (!placed) {
            columns.push([booking]);
            booking.colIndex = columns.length - 1;
        }
    });

    const totalColumns = columns.length;

    return sorted.map(b => ({
        ...b,
        width: 100 / totalColumns,
        left: b.colIndex * (100 / totalColumns)
    }));
};
