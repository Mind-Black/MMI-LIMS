export const getNextSlotTime = (timeStr) => {
    const [h, m] = timeStr.split(':').map(Number);
    let nextM = m + 30;
    let nextH = h;
    if (nextM >= 60) {
        nextH++;
        nextM = 0;
    }
    return `${nextH.toString().padStart(2, '0')}:${nextM.toString().padStart(2, '0')}`;
};

export const groupBookings = (bookings) => {
    if (!bookings.length) return [];

    // Helper to normalize time to HH:MM
    const normalizeTime = (t) => t.slice(0, 5);

    // Sort by Date -> Tool -> Time
    const sorted = [...bookings].sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        if (a.tool_id !== b.tool_id) return a.tool_id - b.tool_id;
        return normalizeTime(a.time).localeCompare(normalizeTime(b.time));
    });

    const groups = [];
    let currentGroup = null;

    sorted.forEach(booking => {
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
            groups.push(currentGroup);
            currentGroup = {
                ...booking,
                ids: [booking.id],
                endTime: getNextSlotTime(normalizedTime),
                startTime: normalizedTime
            };
        }
    });

    if (currentGroup) groups.push(currentGroup);
    return groups;
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

export const checkCollision = (newSlots, existingBookings, ignoredIds = []) => {
    // Normalize time helper
    const normalizeTime = (t) => t.slice(0, 5);

    for (const slot of newSlots) {
        const collision = existingBookings.find(b => {
            if (ignoredIds.includes(b.id)) return false; // Ignore the booking being moved/resized
            return b.date === slot.date && normalizeTime(b.time) === normalizeTime(slot.time) && b.tool_id === slot.tool_id;
        });

        if (collision) return true;
    }
    return false;
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
