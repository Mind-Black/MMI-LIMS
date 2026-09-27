import assert from 'node:assert';
import {
    checkCollision,
    groupBookings,
    calculateEventLayout,
    checkBookingEligibility,
    formatLocalDate
} from './src/utils/bookingUtils.js';

console.log('--- Running MMI-LIMS Booking Logic Verification ---');

// 1. Collision Detection Tests
const booking1 = { id: 1, date: '2026-10-23', startTime: '08:00', endTime: '09:00', tool_id: 1, ids: [1] };
const booking2 = { id: 2, date: '2026-10-23', startTime: '10:00', endTime: '11:00', tool_id: 1, ids: [2] };
const existingBookings = [booking1, booking2];

// Move booking1 to 09:00 (valid adjacent interval)
const move1 = { ...booking1, startTime: '09:00', endTime: '10:00' };
assert.strictEqual(checkCollision(move1, existingBookings, booking1.ids), false, 'Adjacent interval should not collide');

// Move booking1 to 10:00 (exact collision with booking2)
const move2 = { ...booking1, startTime: '10:00', endTime: '11:00' };
assert.strictEqual(checkCollision(move2, existingBookings, booking1.ids), true, 'Exact interval overlap must collide');

// Move booking1 to 08:30 (self-overlap ignored)
const move3 = { ...booking1, startTime: '08:30', endTime: '09:30' };
assert.strictEqual(checkCollision(move3, existingBookings, booking1.ids), false, 'Self-overlap must be ignored');

// Move booking1 to 09:30 (partial overlap with booking2)
const move4 = { ...booking1, startTime: '09:30', endTime: '10:30' };
assert.strictEqual(checkCollision(move4, existingBookings, booking1.ids), true, 'Partial interval overlap must collide');

// Different tool ID should not collide
const diffTool = { ...booking1, tool_id: 99, startTime: '10:00', endTime: '11:00' };
assert.strictEqual(checkCollision(diffTool, existingBookings, []), false, 'Different tool must not collide');

// 2. Normalization & Group ID Preservation (Finding L2)
const multiSlot = [
    { id: 101, tool_id: 1, date: '2026-10-24', time: '09:00', user_id: 'u1', project: 'P1' },
    { id: 102, tool_id: 1, date: '2026-10-24', time: '09:30', user_id: 'u1', project: 'P1' }
];

const grouped = groupBookings(multiSlot);
assert.strictEqual(grouped.length, 1, 'Adjacent slots must be grouped into one');
assert.deepStrictEqual(grouped[0].ids, [101, 102], 'All group IDs must be preserved');
assert.strictEqual(grouped[0].startTime, '09:00');
assert.strictEqual(grouped[0].endTime, '10:00');

// Regrouping must be idempotent and NEVER lose secondary IDs
const regrouped = groupBookings(grouped);
assert.strictEqual(regrouped.length, 1);
assert.deepStrictEqual(regrouped[0].ids, [101, 102], 'Regrouping must be idempotent and preserve all IDs');
assert.strictEqual(regrouped[0].startTime, '09:00');
assert.strictEqual(regrouped[0].endTime, '10:00');

// 3. License-free Equipment Eligibility (Finding L4)
const toolLicenseFree = { id: 4, name: 'Dektak XT', license_req: false, status: 'up' };
const toolLicenseReq = { id: 1, name: 'Raith EBPG', license_req: true, status: 'up' };
const userWithoutLicense = { access_level: 'user', is_approved: true, licenses: [] };
const userWithLicense = { access_level: 'user', is_approved: true, licenses: [1] };
const userPending = { access_level: 'user', is_approved: false, licenses: [1] };

assert.strictEqual(checkBookingEligibility(toolLicenseFree, userWithoutLicense).canBook, true, 'License-free equipment should be bookable');
assert.strictEqual(checkBookingEligibility(toolLicenseReq, userWithoutLicense).canBook, false, 'License-required tool should require license');
assert.strictEqual(checkBookingEligibility(toolLicenseReq, userWithLicense).canBook, true, 'Licensed user can book licensed tool');
assert.strictEqual(checkBookingEligibility(toolLicenseReq, userPending).canBook, false, 'Pending user cannot book');

// 4. Pure Connected Overlap Event Layout (Finding L7)
const events = [
    { id: 1, startTime: '09:00', endTime: '10:00' },
    { id: 2, startTime: '09:30', endTime: '10:30' },
    { id: 3, startTime: '14:00', endTime: '15:00' } // Isolated event in afternoon
];

const layout = calculateEventLayout(events);
assert.strictEqual(events[0].colIndex, undefined, 'Input objects must not be mutated');

const morning1 = layout.find(e => e.id === 1);
const morning2 = layout.find(e => e.id === 2);
const afternoon = layout.find(e => e.id === 3);

assert.strictEqual(morning1.width, 50, 'Overlapping morning events should have 50% width');
assert.strictEqual(morning2.width, 50, 'Overlapping morning events should have 50% width');
assert.strictEqual(afternoon.width, 100, 'Isolated afternoon event should have 100% width');
assert.strictEqual(afternoon.left, 0, 'Isolated afternoon event should start at left 0');

// 5. Timezone & Local Date Formatting (Finding L3)
const sampleDate = new Date(2026, 8, 28, 0, 30); // Sept 28, 00:30
assert.strictEqual(formatLocalDate(sampleDate), '2026-09-28', 'formatLocalDate must preserve calendar date');

console.log('✔ All booking logic assertions passed successfully!');
