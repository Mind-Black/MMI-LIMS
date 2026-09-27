import test from 'node:test';
import assert from 'node:assert';
import {
    timeToMinutes,
    minutesToTime,
    getNextSlotTime,
    formatLocalDate,
    checkBookingEligibility,
    groupBookings,
    checkCollision,
    calculateEventLayout,
    parseCalendarDate,
    getMonday,
    addDays,
    getVilniusInstant,
    isBookingPast,
    isBookingInProgress,
    getVilniusNow,
    getVilniusCurrentMinutes,
    isVilniusToday,
    isBookingStarted,
    isSlotInPast
} from '../src/utils/bookingUtils.js';

test('timeToMinutes & minutesToTime conversion and clamping', () => {
    assert.strictEqual(timeToMinutes('00:00'), 0);
    assert.strictEqual(timeToMinutes('09:30'), 570);
    assert.strictEqual(timeToMinutes('24:00'), 1440);
    assert.strictEqual(timeToMinutes('invalid'), 0);

    assert.strictEqual(minutesToTime(0), '00:00');
    assert.strictEqual(minutesToTime(570), '09:30');
    assert.strictEqual(minutesToTime(1440), '24:00');
    assert.strictEqual(minutesToTime(-50), '00:00'); // Clamped
    assert.strictEqual(minutesToTime(2000), '24:00'); // Clamped

    assert.strictEqual(getNextSlotTime('09:00'), '09:30');
    assert.strictEqual(getNextSlotTime('23:30'), '24:00');
});

test('formatLocalDate formats calendar dates without UTC offset distortion (L3)', () => {
    const d = new Date(2026, 8, 28, 0, 30); // 2026-09-28 00:30 local time
    assert.strictEqual(formatLocalDate(d), '2026-09-28');
});

test('checkBookingEligibility handles license-free equipment and admin overrides (L4)', () => {
    const freeTool = { id: 1, name: 'Dektak XT', license_req: false, status: 'up' };
    const licensedTool = { id: 2, name: 'Raith EBPG', license_req: true, status: 'up' };
    const downTool = { id: 3, name: 'Lesker PVD', license_req: false, status: 'down' };

    const approvedUserWithoutLicense = { access_level: 'user', is_approved: true, licenses: [] };
    const approvedUserWithLicense = { access_level: 'user', is_approved: true, licenses: [2] };
    const unapprovedUser = { access_level: 'user', is_approved: false, licenses: [2] };
    const adminUser = { access_level: 'admin', is_approved: true, licenses: [] };

    // License-free tool can be booked by any approved user
    assert.strictEqual(checkBookingEligibility(freeTool, approvedUserWithoutLicense).canBook, true);

    // License-required tool blocked for unlicensed user
    const res1 = checkBookingEligibility(licensedTool, approvedUserWithoutLicense);
    assert.strictEqual(res1.canBook, false);
    assert.match(res1.reason, /license/i);

    // License-required tool allowed for licensed user
    assert.strictEqual(checkBookingEligibility(licensedTool, approvedUserWithLicense).canBook, true);

    // Unapproved user blocked even if licensed
    assert.strictEqual(checkBookingEligibility(licensedTool, unapprovedUser).canBook, false);

    // Tool down is blocked for ordinary users
    assert.strictEqual(checkBookingEligibility(downTool, approvedUserWithoutLicense).canBook, false);

    // Admin can book any tool regardless of license or status
    assert.strictEqual(checkBookingEligibility(licensedTool, adminUser).canBook, true);
    assert.strictEqual(checkBookingEligibility(downTool, adminUser).canBook, true);

    // Admin override flag
    assert.strictEqual(checkBookingEligibility(downTool, approvedUserWithoutLicense, true).canBook, true);
});

test('groupBookings is idempotent and preserves all group IDs (L2)', () => {
    const multiSlot = [
        { id: 10, tool_id: 1, date: '2026-10-01', time: '10:00', user_id: 'u1', project: 'P1' },
        { id: 11, tool_id: 1, date: '2026-10-01', time: '10:30', user_id: 'u1', project: 'P1' },
        { id: 12, tool_id: 1, date: '2026-10-01', time: '11:00', user_id: 'u1', project: 'P1' }
    ];

    const pass1 = groupBookings(multiSlot);
    assert.strictEqual(pass1.length, 1);
    assert.deepStrictEqual(pass1[0].ids, [10, 11, 12]);
    assert.strictEqual(pass1[0].startTime, '10:00');
    assert.strictEqual(pass1[0].endTime, '11:30');

    // Second normalization pass must NOT lose IDs [11, 12]
    const pass2 = groupBookings(pass1);
    assert.strictEqual(pass2.length, 1);
    assert.deepStrictEqual(pass2[0].ids, [10, 11, 12]);
    assert.strictEqual(pass2[0].startTime, '10:00');
    assert.strictEqual(pass2[0].endTime, '11:30');

    // Single legacy slot without end time receives start + 30 min
    const singleLegacy = [{ id: 99, tool_id: 2, date: '2026-10-02', time: '14:00' }];
    const normalizedSingle = groupBookings(singleLegacy);
    assert.strictEqual(normalizedSingle.length, 1);
    assert.strictEqual(normalizedSingle[0].startTime, '14:00');
    assert.strictEqual(normalizedSingle[0].endTime, '14:30');
});

test('checkCollision implements half-open intervals correctly (S5)', () => {
    const existing = [
        { id: 1, tool_id: 1, date: '2026-10-05', startTime: '10:00', endTime: '12:00' }
    ];

    // Adjacent before: 09:00 - 10:00 -> no collision
    assert.strictEqual(checkCollision({ tool_id: 1, date: '2026-10-05', startTime: '09:00', endTime: '10:00' }, existing), false);

    // Adjacent after: 12:00 - 13:00 -> no collision
    assert.strictEqual(checkCollision({ tool_id: 1, date: '2026-10-05', startTime: '12:00', endTime: '13:00' }, existing), false);

    // Overlapping start: 09:30 - 10:30 -> collision
    assert.strictEqual(checkCollision({ tool_id: 1, date: '2026-10-05', startTime: '09:30', endTime: '10:30' }, existing), true);

    // Overlapping end: 11:30 - 12:30 -> collision
    assert.strictEqual(checkCollision({ tool_id: 1, date: '2026-10-05', startTime: '11:30', endTime: '12:30' }, existing), true);

    // Enclosing: 09:00 - 13:00 -> collision
    assert.strictEqual(checkCollision({ tool_id: 1, date: '2026-10-05', startTime: '09:00', endTime: '13:00' }, existing), true);

    // Self-overlap ignored
    assert.strictEqual(checkCollision({ tool_id: 1, date: '2026-10-05', startTime: '10:30', endTime: '11:30' }, existing, [1]), false);

    // Different tool -> no collision
    assert.strictEqual(checkCollision({ tool_id: 2, date: '2026-10-05', startTime: '10:00', endTime: '12:00' }, existing), false);
});

test('calculateEventLayout clusters overlaps and leaves inputs pure (L7)', () => {
    const originalEvents = [
        { id: 1, startTime: '09:00', endTime: '10:00' },
        { id: 2, startTime: '09:30', endTime: '10:30' },
        { id: 3, startTime: '13:00', endTime: '14:00' } // isolated afternoon event
    ];

    const layout = calculateEventLayout(originalEvents);

    // Inputs must be pure
    assert.strictEqual(originalEvents[0].colIndex, undefined);
    assert.strictEqual(originalEvents[1].colIndex, undefined);
    assert.strictEqual(originalEvents[2].colIndex, undefined);

    const event1 = layout.find(e => e.id === 1);
    const event2 = layout.find(e => e.id === 2);
    const event3 = layout.find(e => e.id === 3);

    assert.strictEqual(event1.width, 50);
    assert.strictEqual(event2.width, 50);
    assert.strictEqual(event3.width, 100);
    assert.strictEqual(event3.left, 0);
});

test('parseCalendarDate, getMonday, and addDays are timezone stable (R6)', () => {
    // Parsing 'YYYY-MM-DD' should represent the exact calendar date at noon
    const d = parseCalendarDate('2026-09-28');
    assert.strictEqual(d.getFullYear(), 2026);
    assert.strictEqual(d.getMonth(), 8); // September (0-indexed)
    assert.strictEqual(d.getDate(), 28);

    // Monday for Monday is the same day
    const mon = getMonday('2026-09-28');
    assert.strictEqual(formatLocalDate(mon), '2026-09-28');

    // Monday for Sunday 2026-10-04 is Monday 2026-09-28
    const monFromSun = getMonday('2026-10-04');
    assert.strictEqual(formatLocalDate(monFromSun), '2026-09-28');

    // addDays adds exactly calendar days
    const nextWeekMon = addDays(mon, 7);
    assert.strictEqual(formatLocalDate(nextWeekMon), '2026-10-05');

    const prevDay = addDays('2026-09-28', -1);
    assert.strictEqual(formatLocalDate(prevDay), '2026-09-27');
});

test('getVilniusInstant resolves Europe/Vilnius time across summer and winter DST boundaries (R6)', () => {
    // Summer (EEST = UTC+3)
    // 10:00 Vilnius on 2026-07-01 is 07:00 UTC
    const summerVilniusMs = getVilniusInstant('2026-07-01', '10:00');
    const expectedSummerUtcMs = Date.UTC(2026, 6, 1, 7, 0, 0);
    assert.strictEqual(summerVilniusMs, expectedSummerUtcMs);

    // Winter (EET = UTC+2)
    // 10:00 Vilnius on 2026-01-15 is 08:00 UTC
    const winterVilniusMs = getVilniusInstant('2026-01-15', '10:00');
    const expectedWinterUtcMs = Date.UTC(2026, 0, 15, 8, 0, 0);
    assert.strictEqual(winterVilniusMs, expectedWinterUtcMs);
});

test('isBookingPast and isBookingInProgress handle ends_at and legacy timestamps authoritatively (R6)', () => {
    const pastDate = new Date(Date.now() - 3600000).toISOString();
    const futureDate = new Date(Date.now() + 3600000).toISOString();
    const farFutureDate = new Date(Date.now() + 7200000).toISOString();

    // Past booking with ends_at
    assert.strictEqual(isBookingPast({ ends_at: pastDate }), true);

    // Future booking with ends_at
    assert.strictEqual(isBookingPast({ ends_at: futureDate }), false);

    // Legacy date in past
    assert.strictEqual(isBookingPast({ date: '2020-01-01', end_time: '10:00' }), true);

    // Legacy date in future
    assert.strictEqual(isBookingPast({ date: '2040-01-01', end_time: '10:00' }), false);

    // In-progress booking
    assert.strictEqual(isBookingInProgress({
        starts_at: pastDate,
        ends_at: futureDate
    }), true);

    // Completed booking is not in progress
    assert.strictEqual(isBookingInProgress({
        starts_at: new Date(Date.now() - 7200000).toISOString(),
        ends_at: pastDate
    }), false);

    // Future booking is not in progress
    assert.strictEqual(isBookingInProgress({
        starts_at: futureDate,
        ends_at: farFutureDate
    }), false);
});

test('getVilniusNow, getVilniusCurrentMinutes, and isVilniusToday calculate Europe/Vilnius lab time (R6)', () => {
    // 2026-07-01 10:00:00 UTC is 13:00:00 in Europe/Vilnius (EEST, UTC+3)
    const summerUtc = new Date(Date.UTC(2026, 6, 1, 10, 0, 0));
    const summerVilnius = getVilniusNow(summerUtc);
    assert.strictEqual(summerVilnius.year, 2026);
    assert.strictEqual(summerVilnius.month, 7);
    assert.strictEqual(summerVilnius.day, 1);
    assert.strictEqual(summerVilnius.hour, 13);
    assert.strictEqual(summerVilnius.minute, 0);
    assert.strictEqual(summerVilnius.dateStr, '2026-07-01');
    assert.strictEqual(summerVilnius.timeStr, '13:00');
    assert.strictEqual(getVilniusCurrentMinutes(summerUtc), 13 * 60);
    assert.strictEqual(isVilniusToday('2026-07-01', summerUtc), true);
    assert.strictEqual(isVilniusToday('2026-07-02', summerUtc), false);

    // 2026-01-15 10:00:00 UTC is 12:00:00 in Europe/Vilnius (EET, UTC+2)
    const winterUtc = new Date(Date.UTC(2026, 0, 15, 10, 0, 0));
    const winterVilnius = getVilniusNow(winterUtc);
    assert.strictEqual(winterVilnius.hour, 12);
    assert.strictEqual(winterVilnius.minute, 0);
    assert.strictEqual(winterVilnius.dateStr, '2026-01-15');
    assert.strictEqual(getVilniusCurrentMinutes(winterUtc), 12 * 60);
    assert.strictEqual(isVilniusToday('2026-01-15', winterUtc), true);
});

test('isSlotInPast and isBookingStarted enforce exact lab time and grace period (R6)', () => {
    // Simulated "now" is 2026-07-01 10:00 UTC (13:00 in Vilnius)
    const simulatedNow = new Date(Date.UTC(2026, 6, 1, 10, 0, 0));

    // Slot at 12:30 Vilnius (started 30 min ago -> past)
    assert.strictEqual(isSlotInPast('2026-07-01', '12:30', simulatedNow), true);

    // Slot at 12:56 Vilnius (started 4 min ago -> within 5 min grace window -> not past)
    assert.strictEqual(isSlotInPast('2026-07-01', '12:56', simulatedNow), false);

    // Slot at 13:00 Vilnius (starts now -> not past)
    assert.strictEqual(isSlotInPast('2026-07-01', '13:00', simulatedNow), false);

    // Slot at 13:30 Vilnius (future -> not past)
    assert.strictEqual(isSlotInPast('2026-07-01', '13:30', simulatedNow), false);

    // isBookingStarted
    const startedBooking = { date: '2026-07-01', startTime: '12:30' };
    const startsAtBooking = { starts_at: new Date(Date.now() - 60000).toISOString() };
    const futureBooking = { starts_at: new Date(Date.now() + 60000).toISOString() };

    assert.strictEqual(isBookingStarted(startedBooking), true);
    assert.strictEqual(isBookingStarted(startsAtBooking), true);
    assert.strictEqual(isBookingStarted(futureBooking), false);
});

