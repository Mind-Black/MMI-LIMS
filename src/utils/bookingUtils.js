/**
 * Centralized booking utilities for MMI-LIMS
 * Lab timezone: Europe/Vilnius
 */

export const LAB_TIMEZONE = 'Europe/Vilnius';

/**
 * Converts a time string (HH:MM or HH:MM:SS) to minutes from midnight.
 * Clamps safely to [0, 1440].
 */
export const timeToMinutes = (timeStr) => {
    if (!timeStr || typeof timeStr !== 'string') return 0;
    const parts = timeStr.split(':').map(Number);
    const h = isNaN(parts[0]) ? 0 : parts[0];
    const m = isNaN(parts[1]) ? 0 : parts[1];
    return Math.max(0, Math.min(1440, (h * 60) + m));
};

/**
 * Converts total minutes from midnight into HH:MM string.
 * Clamps between 00:00 and 24:00.
 */
export const minutesToTime = (totalMins) => {
    const clamped = Math.max(0, Math.min(1440, Math.round(totalMins)));
    const h = Math.floor(clamped / 60);
    const m = clamped % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

/**
 * Rounds minutes to the nearest slot increment (default 30 mins).
 */
export const roundToNearestSlot = (minutes, slotSize = 30) => {
    return Math.round(minutes / slotSize) * slotSize;
};

/**
 * Returns the time string 30 minutes after timeStr.
 */
export const getNextSlotTime = (timeStr) => {
    const mins = timeToMinutes(timeStr);
    return minutesToTime(mins + 30);
};

/**
 * Formats a Date object as YYYY-MM-DD using local/calendar date components
 * to avoid UTC offset shifts (e.g. midnight becoming the previous day in UTC).
 */
export const formatLocalDate = (date) => {
    if (!date || isNaN(new Date(date).getTime())) return '';
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

/**
 * Formats a date string or Date object for UI display
 */
export const formatDisplayDate = (date) => {
    try {
        const d = typeof date === 'string' ? new Date(`${date}T00:00:00`) : new Date(date);
        if (isNaN(d.getTime())) return 'Invalid Date';
        return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    } catch {
        return 'Invalid Date';
    }
};

/**
 * Centralized equipment booking eligibility check.
 * Handles license-free equipment (tool.license_req = false) and admin overrides.
 */
export const checkBookingEligibility = (tool, profile, isAdminOverride = false) => {
    if (!tool) {
        return { canBook: false, reason: 'Tool details missing' };
    }
    const isAdmin = profile?.access_level === 'admin';
    if (isAdmin || isAdminOverride) {
        return { canBook: true, reason: null };
    }
    if (!profile?.is_approved) {
        return { canBook: false, reason: 'Your account is pending administrator approval' };
    }
    if (tool.status !== 'up') {
        return { canBook: false, reason: `Equipment is currently ${tool.status}` };
    }
    const hasLicense = Array.isArray(profile?.licenses) && profile.licenses.includes(tool.id);
    if (tool.license_req && !hasLicense) {
        return { canBook: false, reason: 'License required for this equipment' };
    }
    return { canBook: true, reason: null };
};

/**
 * Normalizes and groups bookings.
 * IDEMPOTENT: Normalizing an already grouped booking preserves its IDs and canonical fields.
 * Legacy bookings without an end_time automatically receive default (start + 30m).
 */
export const groupBookings = (bookings) => {
    if (!bookings || !Array.isArray(bookings) || bookings.length === 0) return [];

    const normalizeTime = (t) => {
        if (!t) return '00:00';
        return String(t).slice(0, 5);
    };

    const canonicalList = [];
    const legacySlots = [];

    bookings.forEach(b => {
        if (!b) return;

        const dateStr = b.date ? (typeof b.date === 'string' ? b.date.slice(0, 10) : formatLocalDate(b.date)) : '';
        const startTime = normalizeTime(b.startTime || b.time);
        const rawEndTime = b.endTime || b.end_time;

        // If it already has an end time, it is a range booking or previously grouped
        if (rawEndTime) {
            const endTime = normalizeTime(rawEndTime);
            // Preserve existing IDs array if already grouped
            const ids = Array.isArray(b.ids) && b.ids.length > 0 ? [...b.ids] : (b.id != null ? [b.id] : []);
            canonicalList.push({
                ...b,
                date: dateStr,
                time: startTime,
                startTime,
                end_time: endTime,
                endTime,
                ids
            });
        } else {
            // Un-grouped legacy single slot row
            legacySlots.push({
                ...b,
                date: dateStr,
                time: startTime
            });
        }
    });

    // Group adjacent legacy slots if any exist
    if (legacySlots.length > 0) {
        const sortedSlots = [...legacySlots].sort((a, b) => {
            if (a.date !== b.date) return a.date.localeCompare(b.date);
            if (a.tool_id !== b.tool_id) return (a.tool_id ?? 0) - (b.tool_id ?? 0);
            return a.time.localeCompare(b.time);
        });

        let currentGroup = null;

        sortedSlots.forEach(slot => {
            const slotStart = slot.time;
            const slotEnd = getNextSlotTime(slotStart);

            if (!currentGroup) {
                currentGroup = {
                    ...slot,
                    ids: [slot.id],
                    startTime: slotStart,
                    time: slotStart,
                    endTime: slotEnd,
                    end_time: slotEnd
                };
                return;
            }

            const isSameDate = slot.date === currentGroup.date;
            const isSameTool = slot.tool_id === currentGroup.tool_id;
            const isSameUser = slot.user_id === currentGroup.user_id;
            const isSameProject = slot.project === currentGroup.project;
            const isContinuous = slotStart === currentGroup.endTime;

            if (isSameDate && isSameTool && isSameUser && isSameProject && isContinuous) {
                currentGroup.ids.push(slot.id);
                currentGroup.endTime = slotEnd;
                currentGroup.end_time = slotEnd;
            } else {
                canonicalList.push(currentGroup);
                currentGroup = {
                    ...slot,
                    ids: [slot.id],
                    startTime: slotStart,
                    time: slotStart,
                    endTime: slotEnd,
                    end_time: slotEnd
                };
            }
        });

        if (currentGroup) {
            canonicalList.push(currentGroup);
        }
    }

    // Sort all bookings by date -> startTime
    return canonicalList.sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        return a.startTime.localeCompare(b.startTime);
    });
};

/**
 * Generates half-hour slots for a given date and range.
 */
export const generateSlots = (date, startTime, endTime) => {
    const slots = [];
    let current = startTime.slice(0, 5);
    const end = endTime.slice(0, 5);

    while (current < end) {
        slots.push({ date, time: current });
        current = getNextSlotTime(current);
        if (timeToMinutes(current) >= 1440) break;
    }
    return slots;
};

/**
 * Checks if newBooking collides with existingBookings for the same tool.
 * Half-open interval comparison [start, end) ensures adjacent bookings do not collide.
 */
export const checkCollision = (newBooking, existingBookings, ignoredIds = []) => {
    if (!newBooking || !existingBookings || !Array.isArray(existingBookings)) return false;

    const newStart = timeToMinutes(newBooking.startTime || newBooking.time);
    const newEnd = timeToMinutes(newBooking.endTime || newBooking.end_time);

    if (newEnd <= newStart) return true; // Malformed range is considered invalid/colliding

    const ignoreSet = new Set(Array.isArray(ignoredIds) ? ignoredIds : [ignoredIds]);

    return existingBookings.some(b => {
        if (!b) return false;
        if (b.id != null && ignoreSet.has(b.id)) return false;
        if (Array.isArray(b.ids) && b.ids.some(id => ignoreSet.has(id))) return false;
        if (b.date !== newBooking.date) return false;
        if (String(b.tool_id) !== String(newBooking.tool_id)) return false;

        const bStart = timeToMinutes(b.startTime || b.time);
        const bEnd = timeToMinutes(b.endTime || b.end_time || getNextSlotTime(b.startTime || b.time));

        // Half-open interval overlap check: [newStart, newEnd) overlaps [bStart, bEnd)
        return (newStart < bEnd && newEnd > bStart);
    });
};

/**
 * Calculates event layout columns pure and per connected-overlap cluster.
 * Fixes L7:
 * - Does NOT mutate input booking objects.
 * - Clusters overlapping events: an isolated event receives full width (100%) even if other
 *   events earlier in the day overlapped.
 */
export const calculateEventLayout = (bookings) => {
    if (!bookings || !Array.isArray(bookings) || bookings.length === 0) return [];

    // 1. Prepare items without mutating originals
    const items = bookings.map((b, originalIndex) => {
        const start = timeToMinutes(b.startTime || b.time || '00:00');
        const end = timeToMinutes(b.endTime || b.end_time || getNextSlotTime(b.startTime || b.time));
        return {
            originalIndex,
            booking: b,
            start,
            end: Math.max(start + 30, end)
        };
    });

    // 2. Sort by start time, then duration descending
    items.sort((a, b) => {
        if (a.start !== b.start) return a.start - b.start;
        return (b.end - b.start) - (a.end - a.start);
    });

    // 3. Partition into connected overlap clusters
    const clusters = [];
    let currentCluster = [];
    let clusterMaxEnd = -1;

    items.forEach(item => {
        if (currentCluster.length === 0) {
            currentCluster.push(item);
            clusterMaxEnd = item.end;
        } else if (item.start < clusterMaxEnd) {
            // Overlaps with current cluster
            currentCluster.push(item);
            clusterMaxEnd = Math.max(clusterMaxEnd, item.end);
        } else {
            // Disjoint: finish previous cluster, start new one
            clusters.push(currentCluster);
            currentCluster = [item];
            clusterMaxEnd = item.end;
        }
    });
    if (currentCluster.length > 0) {
        clusters.push(currentCluster);
    }

    // 4. Place items in columns within each cluster independently
    const results = [];

    clusters.forEach(cluster => {
        const columns = []; // array of end times for each column

        const placedInCluster = cluster.map(item => {
            let colIndex = -1;
            for (let i = 0; i < columns.length; i++) {
                if (item.start >= columns[i]) {
                    colIndex = i;
                    columns[i] = item.end;
                    break;
                }
            }
            if (colIndex === -1) {
                colIndex = columns.length;
                columns.push(item.end);
            }
            return {
                ...item,
                colIndex
            };
        });

        const numCols = Math.max(1, columns.length);
        const width = 100 / numCols;

        placedInCluster.forEach(item => {
            results.push({
                ...item.booking,
                colIndex: item.colIndex,
                width,
                left: item.colIndex * width
            });
        });
    });

    return results;
};
