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
 * Parses calendar dates safely at local noon to avoid UTC midnight shifts
 * across differing timezones (Fixes R6).
 */
export const parseCalendarDate = (dateVal) => {
    if (!dateVal) return new Date();
    if (dateVal instanceof Date) return new Date(dateVal.getFullYear(), dateVal.getMonth(), dateVal.getDate(), 12, 0, 0);
    const dateStr = String(dateVal).split('T')[0];
    const parts = dateStr.split('-').map(Number);
    if (parts.length === 3 && !parts.some(isNaN)) {
        return new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0);
    }
    const d = new Date(dateVal);
    return isNaN(d.getTime()) ? new Date() : new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0);
};

/**
 * Returns Monday of the week for a given calendar date without timezone shift (Fixes R6).
 */
export const getMonday = (dateVal) => {
    const d = parseCalendarDate(dateVal);
    const day = d.getDay(); // 0 is Sunday, 1 is Monday...
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff);
    return d;
};

/**
 * Adds days to a calendar date safely.
 */
export const addDays = (dateVal, days) => {
    const d = parseCalendarDate(dateVal);
    d.setDate(d.getDate() + days);
    return d;
};

/**
 * Formats a Date object or date string as YYYY-MM-DD using calendar components.
 */
export const formatLocalDate = (date) => {
    if (!date) return '';
    const d = parseCalendarDate(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

/**
 * Converts a Europe/Vilnius date string ('YYYY-MM-DD') and time string ('HH:mm')
 * to exact UTC epoch milliseconds (Fixes R6).
 */
export const getVilniusInstant = (dateStr, timeStr = '00:00') => {
    const [y, m, d] = dateStr.split('-').map(Number);
    const [hh, mm] = timeStr.slice(0, 5).split(':').map(Number);
    const utcGuess = Date.UTC(y, m - 1, d, hh, mm, 0);

    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: LAB_TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });

    const parts = formatter.formatToParts(new Date(utcGuess));
    const getPart = (type) => Number(parts.find(p => p.type === type)?.value || 0);
    const vY = getPart('year');
    const vM = getPart('month');
    const vD = getPart('day');
    let vH = getPart('hour');
    if (vH === 24) vH = 0;
    const vMin = getPart('minute');

    const vilniusAsUtc = Date.UTC(vY, vM - 1, vD, vH, vMin, 0);
    const offsetMs = vilniusAsUtc - utcGuess;

    return utcGuess - offsetMs;
};

/**
 * Checks whether a booking has already ended.
 * Timezone-authoritative across all browser locations (Vilnius, UTC, LA, Tokyo) (Fixes R6).
 */
export const isBookingPast = (booking) => {
    if (!booking) return false;

    // 1. Authoritative UTC instant from database range column
    if (booking.ends_at) {
        const endTimeMs = new Date(booking.ends_at).getTime();
        if (!isNaN(endTimeMs)) {
            return endTimeMs < Date.now();
        }
    }

    // 2. Legacy fallback: parse date + end_time in Europe/Vilnius
    const dateStr = booking.date;
    const timeStr = booking.end_time || booking.endTime || booking.time || '23:59';
    if (!dateStr) return false;

    return getVilniusInstant(dateStr, timeStr) < Date.now();
};

/**
 * Checks whether a booking is currently in progress.
 * Timezone-authoritative across all browser locations (Vilnius, UTC, LA, Tokyo) (Fixes R6).
 */
export const isBookingInProgress = (booking) => {
    if (!booking) return false;
    const now = Date.now();

    // 1. Authoritative UTC instants from database range columns
    if (booking.starts_at && booking.ends_at) {
        const startMs = new Date(booking.starts_at).getTime();
        const endMs = new Date(booking.ends_at).getTime();
        if (!isNaN(startMs) && !isNaN(endMs)) {
            return startMs <= now && endMs > now;
        }
    }

    // 2. Legacy fallback: parse date + start/end in Europe/Vilnius
    const dateStr = booking.date;
    if (!dateStr) return false;
    const startTimeStr = booking.time || booking.startTime || '00:00';
    const endTimeStr = booking.end_time || booking.endTime || '23:59';

    const startMs = getVilniusInstant(dateStr, startTimeStr);
    const endMs = getVilniusInstant(dateStr, endTimeStr);

    return !isNaN(startMs) && !isNaN(endMs) && startMs <= now && endMs > now;
};

/**
 * Returns current date and time components in Europe/Vilnius timezone.
 * Authoritative for lab time regardless of browser timezone.
 */
export const getVilniusNow = (nowVal = new Date()) => {
    const d = nowVal instanceof Date ? nowVal : new Date(nowVal);
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: LAB_TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });
    const parts = formatter.formatToParts(d);
    const getPart = (type) => Number(parts.find(p => p.type === type)?.value || 0);
    const year = getPart('year');
    const month = getPart('month');
    const day = getPart('day');
    let hour = getPart('hour');
    if (hour === 24) hour = 0;
    const minute = getPart('minute');
    const second = getPart('second');
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    return { year, month, day, hour, minute, second, dateStr, timeStr };
};

/**
 * Returns total minutes from midnight in Europe/Vilnius.
 */
export const getVilniusCurrentMinutes = (nowVal = new Date()) => {
    const { hour, minute } = getVilniusNow(nowVal);
    return (hour * 60) + minute;
};

/**
 * Checks whether a given calendar date corresponds to today in Europe/Vilnius.
 */
export const isVilniusToday = (dateVal, nowVal = new Date()) => {
    if (!dateVal) return false;
    const dStr = formatLocalDate(dateVal);
    const { dateStr } = getVilniusNow(nowVal);
    return dStr === dateStr;
};

/**
 * Checks whether a booking has already started in Europe/Vilnius.
 */
export const isBookingStarted = (booking) => {
    if (!booking) return false;
    if (booking.starts_at) {
        const startMs = new Date(booking.starts_at).getTime();
        if (!isNaN(startMs)) return startMs <= Date.now();
    }
    const dateStr = booking.date;
    const timeStr = booking.startTime || booking.time || '00:00';
    if (!dateStr) return false;
    return getVilniusInstant(dateStr, timeStr) <= Date.now();
};

/**
 * Checks whether a booking slot starting at timeStr on dateStr has already passed
 * and can no longer be booked. Aligned with the database constraint allowing a 5-minute
 * grace window. Timezone-authoritative for Europe/Vilnius.
 */
export const isSlotInPast = (dateStr, timeStr, nowVal = new Date()) => {
    if (!dateStr || !timeStr) return false;
    const slotStartMs = getVilniusInstant(dateStr, timeStr);
    const nowMs = nowVal instanceof Date ? nowVal.getTime() : new Date(nowVal).getTime();
    return (slotStartMs + 5 * 60 * 1000) < nowMs;
};


/**
 * Formats a date string or Date object for UI display
 */
export const formatDisplayDate = (date) => {
    try {
        const d = parseCalendarDate(date);
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
