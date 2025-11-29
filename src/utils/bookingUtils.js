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

    // Sort by Date -> Tool -> Time
    const sorted = [...bookings].sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        if (a.tool_id !== b.tool_id) return a.tool_id - b.tool_id;
        return a.time.localeCompare(b.time);
    });

    const groups = [];
    let currentGroup = null;

    sorted.forEach(booking => {
        if (!currentGroup) {
            currentGroup = {
                ...booking,
                ids: [booking.id],
                endTime: getNextSlotTime(booking.time),
                startTime: booking.time
            };
            return;
        }

        const isSameDate = booking.date === currentGroup.date;
        const isSameTool = booking.tool_id === currentGroup.tool_id;
        const isContinuous = booking.time === currentGroup.endTime;

        if (isSameDate && isSameTool && isContinuous) {
            currentGroup.ids.push(booking.id);
            currentGroup.endTime = getNextSlotTime(booking.time);
        } else {
            groups.push(currentGroup);
            currentGroup = {
                ...booking,
                ids: [booking.id],
                endTime: getNextSlotTime(booking.time),
                startTime: booking.time
            };
        }
    });

    if (currentGroup) groups.push(currentGroup);
    return groups;
};
