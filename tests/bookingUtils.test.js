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
    calculateEventLayout
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
