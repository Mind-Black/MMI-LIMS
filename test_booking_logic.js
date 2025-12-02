
// Mock utils
const timeToMinutes = (timeStr) => {
    const [h, m] = timeStr.split(':').map(Number);
    return (h * 60) + m;
};

const minutesToTime = (totalMins) => {
    let h = Math.floor(totalMins / 60);
    let m = Math.round(totalMins % 60);
    if (m === 60) { h += 1; m = 0; }
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
};

const roundToNearestSlot = (minutes, slotSize = 30) => {
    return Math.round(minutes / slotSize) * slotSize;
};

const checkCollision = (newBooking, existingBookings, ignoredIds = []) => {
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

// Constants
const PIXELS_PER_30_MINS = 48;
const START_HOUR = 8;
const WEEK_DATES = ['2023-10-23', '2023-10-24', '2023-10-25', '2023-10-26', '2023-10-27', '2023-10-28', '2023-10-29'];

// Test Collision
const booking1 = { id: 1, date: '2023-10-23', startTime: '08:00', endTime: '09:00', tool_id: 1, ids: [1] };
const booking2 = { id: 2, date: '2023-10-23', startTime: '10:00', endTime: '11:00', tool_id: 1, ids: [2] };
const existingBookings = [booking1, booking2];

console.log('--- Testing Collision ---');

// 1. Move booking1 to 09:00 (no collision)
const move1 = { ...booking1, startTime: '09:00', endTime: '10:00' };
const collision1 = checkCollision(move1, existingBookings, booking1.ids);
console.log(`Move booking1 to 09:00 (valid): Collision=${collision1}`);

// 2. Move booking1 to 10:00 (collision with booking2)
const move2 = { ...booking1, startTime: '10:00', endTime: '11:00' };
const collision2 = checkCollision(move2, existingBookings, booking1.ids);
console.log(`Move booking1 to 10:00 (collision): Collision=${collision2}`);

// 3. Move booking1 to 08:30 (overlap with itself if not ignored, but ignored)
const move3 = { ...booking1, startTime: '08:30', endTime: '09:30' };
const collision3 = checkCollision(move3, existingBookings, booking1.ids);
console.log(`Move booking1 to 08:30 (self-overlap ignored): Collision=${collision3}`);

// 4. Move booking1 to 09:30 (overlap with booking2)
const move4 = { ...booking1, startTime: '09:30', endTime: '10:30' };
const collision4 = checkCollision(move4, existingBookings, booking1.ids);
console.log(`Move booking1 to 09:30 (overlap booking2): Collision=${collision4}`);

