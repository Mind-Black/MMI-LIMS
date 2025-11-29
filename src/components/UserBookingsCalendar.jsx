import React, { useState, useMemo } from 'react';

const UserBookingsCalendar = ({ bookings }) => {
    // Initialize week start to current week's Monday
    const [currentWeekStart, setCurrentWeekStart] = useState(() => {
        const d = new Date();
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday
        return new Date(d.setDate(diff));
    });

    // Helper to get dates for the week
    const weekDates = useMemo(() => {
        const dates = [];
        try {
            for (let i = 0; i < 7; i++) {
                const d = new Date(currentWeekStart);
                d.setDate(currentWeekStart.getDate() + i);
                dates.push(d);
            }
        } catch (e) {
            console.error('Error generating week dates', e);
        }
        return dates;
    }, [currentWeekStart]);

    // Helper to generate 30-min slots from 08:00 to 20:00
    const timeSlots = useMemo(() => {
        const slots = [];
        for (let h = 8; h < 20; h++) {
            const hStr = h < 10 ? '0' + h : h;
            slots.push(`${hStr}:00`);
            slots.push(`${hStr}:30`);
        }
        return slots;
    }, []);

    const formatDate = (date) => {
        try {
            return date.toISOString().split('T')[0];
        } catch (e) {
            return '';
        }
    };

    const displayDate = (date) => {
        try {
            return date.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' });
        } catch (e) {
            return 'Invalid Date';
        }
    };

    const getBookingsForSlot = (dateStr, timeStr) => {
        return bookings.filter(b => b.date === dateStr && b.time === timeStr);
    };

    // Navigation
    const handlePrevWeek = () => {
        const newDate = new Date(currentWeekStart);
        newDate.setDate(newDate.getDate() - 7);
        setCurrentWeekStart(newDate);
    };

    const handleNextWeek = () => {
        const newDate = new Date(currentWeekStart);
        newDate.setDate(newDate.getDate() + 7);
        setCurrentWeekStart(newDate);
    };

    return (
        <div className="bg-white rounded-lg shadow-sm border flex flex-col overflow-hidden h-[600px]">
            {/* Header */}
            <div className="p-4 border-b bg-gray-50 flex justify-between items-center shrink-0">
                <h3 className="font-bold text-gray-800 text-lg">Weekly Schedule</h3>
                <div className="flex items-center gap-4">
                    <button onClick={handlePrevWeek} className="p-2 hover:bg-gray-200 rounded"><i className="fas fa-chevron-left"></i></button>
                    <div className="font-bold text-gray-700 w-48 text-center">
                        {weekDates[0].toLocaleDateString()} - {weekDates[6].toLocaleDateString()}
                    </div>
                    <button onClick={handleNextWeek} className="p-2 hover:bg-gray-200 rounded"><i className="fas fa-chevron-right"></i></button>
                </div>
            </div>

            {/* Calendar Grid Container */}
            <div className="flex-1 overflow-auto custom-scroll relative select-none">
                <div className="min-w-[800px]">

                    {/* Header Row (Days) */}
                    <div className="grid grid-cols-[80px_repeat(7,1fr)] bg-white border-b sticky top-0 z-20 shadow-sm">
                        <div className="p-2 border-r bg-gray-50"></div>
                        {weekDates.map((date, i) => (
                            <div key={i} className="p-2 text-center border-r font-semibold text-gray-700 text-sm bg-gray-50">
                                {displayDate(date)}
                            </div>
                        ))}
                    </div>

                    {/* Body Rows (Time Slots) */}
                    {timeSlots.map(time => (
                        <div key={time} className="grid grid-cols-[80px_repeat(7,1fr)] border-b last:border-0 h-16">
                            {/* Time Label */}
                            <div className="p-2 text-right text-xs text-gray-500 border-r bg-gray-50 font-mono flex items-center justify-end sticky left-0 z-10">
                                {time}
                            </div>

                            {/* Slots */}
                            {weekDates.map((date, i) => {
                                const dateStr = formatDate(date);
                                const slotBookings = getBookingsForSlot(dateStr, time);
                                const hasBookings = slotBookings.length > 0;

                                return (
                                    <div
                                        key={`${dateStr}-${time}`}
                                        className="border-r p-0.5 flex items-stretch overflow-hidden bg-white"
                                    >
                                        {hasBookings && slotBookings.map((booking, idx) => (
                                            <div
                                                key={booking.id || idx}
                                                className="flex-1 bg-blue-100 border border-blue-200 rounded text-[10px] p-1 text-blue-800 font-semibold overflow-hidden flex items-center justify-center text-center leading-tight mx-0.5"
                                                title={`${booking.tool_name}\n${booking.project}`}
                                            >
                                                {booking.tool_name}
                                            </div>
                                        ))}
                                    </div>
                                );
                            })}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default UserBookingsCalendar;
