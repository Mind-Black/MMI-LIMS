import test from 'node:test';
import assert from 'node:assert';
import {
    timeToMinutes,
    minutesToTime,
    checkCollision,
    getMonday,
    addDays,
    formatLocalDate
} from '../src/utils/bookingUtils.js';

test('slotHeight (32px) math correctly aligns slots and durations', () => {
    const SLOT_HEIGHT = 32;

    // 08:00 to 18:00 working day = 10 hours = 20 slots of 30 minutes
    const workingDaySlots = 20;
    const workingDayHeight = workingDaySlots * SLOT_HEIGHT;
    assert.strictEqual(workingDayHeight, 640); // 640px easily fits inside standard 750-850px modal body

    // 08:00 to 20:00 = 12 hours = 24 slots
    const extendedDayHeight = 24 * SLOT_HEIGHT;
    assert.strictEqual(extendedDayHeight, 768);

    // Initial scroll offset for 08:00 AM:
    // (8 hours * 2 slots/hr) * 32px = 16 * 32 = 512px
    const scrollOffset8AM = (8 * 2) * SLOT_HEIGHT;
    assert.strictEqual(scrollOffset8AM, 512);

    // Converting pixel delta to snapped slot increment
    const deltaY1 = 28; // dragged down by 28px -> rounds to 32px (1 slot = 30m)
    const snapped1 = Math.round(deltaY1 / SLOT_HEIGHT) * SLOT_HEIGHT;
    assert.strictEqual(snapped1, 32);

    const deltaY2 = 60; // dragged down by 60px -> rounds to 64px (2 slots = 1h)
    const snapped2 = Math.round(deltaY2 / SLOT_HEIGHT) * SLOT_HEIGHT;
    assert.strictEqual(snapped2, 64);
});

test('draft window movement validation and collision snap-back logic', () => {
    const existingBookings = [
        { id: 101, tool_id: 1, date: '2026-10-07', startTime: '11:00', endTime: '13:00' },
        { id: 102, tool_id: 1, date: '2026-10-08', startTime: '14:00', endTime: '16:00' }
    ];

    // Candidate 1: Move draft to 2026-10-07 09:00 - 11:00 (adjacent before booking 101)
    const candidateValid = { tool_id: 1, date: '2026-10-07', startTime: '09:00', endTime: '11:00' };
    assert.strictEqual(checkCollision(candidateValid, existingBookings), false);

    // Candidate 2: Move draft to 2026-10-07 10:30 - 12:30 (overlaps booking 101) -> MUST COLLIDE (illegal move)
    const candidateOverlap = { tool_id: 1, date: '2026-10-07', startTime: '10:30', endTime: '12:30' };
    assert.strictEqual(checkCollision(candidateOverlap, existingBookings), true);

    // Candidate 3: Move draft between days to 2026-10-08 10:00 - 12:00 (free slot on Thursday) -> VALID
    const candidateNextDayValid = { tool_id: 1, date: '2026-10-08', startTime: '10:00', endTime: '12:00' };
    assert.strictEqual(checkCollision(candidateNextDayValid, existingBookings), false);

    // Candidate 4: Move draft between days to 2026-10-08 14:30 - 16:30 (overlaps booking 102) -> MUST COLLIDE
    const candidateNextDayOverlap = { tool_id: 1, date: '2026-10-08', startTime: '14:30', endTime: '16:30' };
    assert.strictEqual(checkCollision(candidateNextDayOverlap, existingBookings), true);
});

test('draft window resizing validation and minimum duration clamping', () => {
    const SLOT_HEIGHT = 32;

    // Initial 10:00 - 12:00 draft window (initialTop: 640px, initialHeight: 128px)
    const initialTop = (timeToMinutes('10:00') / 30) * SLOT_HEIGHT;
    const initialHeight = (120 / 30) * SLOT_HEIGHT;
    assert.strictEqual(initialTop, 640);
    assert.strictEqual(initialHeight, 128);

    // Bottom resize by +30m (deltaY = +32px)
    const newHeightExt = initialHeight + 32;
    const endMinsExt = (initialTop / SLOT_HEIGHT) * 30 + (newHeightExt / SLOT_HEIGHT) * 30;
    assert.strictEqual(minutesToTime(endMinsExt), '12:30');

    // Bottom resize shorten to less than 30m -> clamped to minimum 32px (30m)
    let shortenedHeight = initialHeight - 160; // Would be negative
    if (shortenedHeight < SLOT_HEIGHT) shortenedHeight = SLOT_HEIGHT;
    assert.strictEqual(shortenedHeight, 32);

    // Top resize by -30m (move start earlier: deltaY = -32px)
    const newTopExt = initialTop - 32;
    const newHeightWithTopExt = initialHeight + 32;
    const startMinsExt = (newTopExt / SLOT_HEIGHT) * 30;
    assert.strictEqual(minutesToTime(startMinsExt), '09:30');
    assert.strictEqual((newHeightWithTopExt / SLOT_HEIGHT) * 30, 150); // 2h 30m total
});

test('inter-day date navigation correctly resolves Monday-aligned week dates', () => {
    const monday = getMonday('2026-10-07'); // Wednesday -> returns Monday 2026-10-05
    assert.strictEqual(formatLocalDate(monday), '2026-10-05');

    const weekDates = [];
    for (let i = 0; i < 7; i++) {
        weekDates.push(formatLocalDate(addDays(monday, i)));
    }
    assert.deepStrictEqual(weekDates, [
        '2026-10-05', // Mon
        '2026-10-06', // Tue
        '2026-10-07', // Wed
        '2026-10-08', // Thu
        '2026-10-09', // Fri
        '2026-10-10', // Sat
        '2026-10-11'  // Sun
    ]);

    // Dragging from Wednesday (index 2) by +2 days -> Friday (index 4)
    const wedIndex = 2;
    const targetIndex = Math.max(0, Math.min(6, wedIndex + 2));
    assert.strictEqual(weekDates[targetIndex], '2026-10-09');

    // Dragging past Sunday clamped to Sunday (index 6)
    const overdragIndex = Math.max(0, Math.min(6, wedIndex + 10));
    assert.strictEqual(weekDates[overdragIndex], '2026-10-11');
});
