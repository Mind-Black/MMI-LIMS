import React, { useMemo, useEffect, useRef, useState } from 'react';
import { groupBookings, calculateEventLayout } from '../utils/bookingUtils';

const UserBookingsCalendar = ({ bookings, currentWeekStart, onWeekChange, onBookingClick }) => {
    const scrollContainerRef = useRef(null);

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
        for (let h = 0; h < 24; h++) {
            const hStr = h < 10 ? '0' + h : h;
            slots.push(`${hStr}:00`);
            slots.push(`${hStr}:30`);
        }
        return slots;
    }, []);

    const PIXELS_PER_30_MINS = 48;
    const START_HOUR = 0;

    const [currentTime, setCurrentTime] = useState(new Date());

    useEffect(() => {
        // Update time every minute
        const timer = setInterval(() => {
            setCurrentTime(new Date());
        }, 60000);
        return () => clearInterval(timer);
    }, []);

    const getCurrentTimeTop = () => {
        const hours = currentTime.getHours();
        const minutes = currentTime.getMinutes();
        const totalMinutes = (hours - START_HOUR) * 60 + minutes;
        return (totalMinutes / 30) * PIXELS_PER_30_MINS;
    };

    const isToday = (date) => {
        const today = new Date();
        return date.getDate() === today.getDate() &&
            date.getMonth() === today.getMonth() &&
            date.getFullYear() === today.getFullYear();
    };

    // Scroll to 9 AM on mount
    useEffect(() => {
        if (scrollContainerRef.current) {
            // 9 AM is 9 hours from start (00:00)
            const hoursFromStart = 9 - START_HOUR;
            const slotsFromStart = hoursFromStart * 2; // 2 slots per hour
            const pixelsToScroll = slotsFromStart * PIXELS_PER_30_MINS;

            scrollContainerRef.current.scrollTop = pixelsToScroll;
        }
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

    // Group bookings for display
    const groupedBookings = useMemo(() => {
        return groupBookings(bookings);
    }, [bookings]);

    const getEventStyle = (booking) => {
        const startHour = parseInt(booking.startTime.split(':')[0]);
        const startMin = parseInt(booking.startTime.split(':')[1]);
        const endHour = parseInt(booking.endTime.split(':')[0]);
        const endMin = parseInt(booking.endTime.split(':')[1]);

        const startOffset = (startHour - START_HOUR) * 60 + startMin;
        const endOffset = (endHour - START_HOUR) * 60 + endMin;
        const duration = endOffset - startOffset;

        const top = (startOffset / 30) * PIXELS_PER_30_MINS;
        const height = (duration / 30) * PIXELS_PER_30_MINS;

        return {
            top: `${top}px`,
            height: `${height - 1}px`, // -1 for border/gap
            left: booking.left !== undefined ? `${booking.left}%` : '2px',
            width: booking.width !== undefined ? `${booking.width}%` : 'calc(100% - 4px)',
            position: 'absolute',
            zIndex: 10
        };
    };

    // Navigation
    const handlePrevWeek = () => {
        const newDate = new Date(currentWeekStart);
        newDate.setDate(newDate.getDate() - 7);
        onWeekChange(newDate);
    };

    const handleNextWeek = () => {
        const newDate = new Date(currentWeekStart);
        newDate.setDate(newDate.getDate() + 7);
        onWeekChange(newDate);
    };

    return (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border dark:border-gray-700 flex flex-col overflow-hidden h-[950px] transition-colors">
            {/* Header */}
            <div className="p-1 border-b dark:border-gray-700 bg-gray-50 dark:bg-gray-900 flex justify-between items-center shrink-0 transition-colors">
                {/* <h3 className="font-bold text-gray-800 text-lg">Weekly Schedule</h3> */}
                <div className="flex items-center gap-4">
                    <button onClick={handlePrevWeek} className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 rounded transition-colors"><i className="fas fa-chevron-left"></i></button>
                    <div className="font-bold text-gray-700 dark:text-gray-200 w-48 text-center transition-colors">
                        {weekDates[0].toLocaleDateString()} - {weekDates[6].toLocaleDateString()}
                    </div>
                    <button onClick={handleNextWeek} className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 rounded transition-colors"><i className="fas fa-chevron-right"></i></button>
                </div>
            </div>

            {/* Calendar Grid Container */}
            <div ref={scrollContainerRef} className="flex-1 overflow-auto custom-scroll relative select-none">
                <div className="min-w-[800px] flex">

                    {/* Time Labels Column */}
                    <div className="w-[50px] shrink-0 bg-gray-50 dark:bg-gray-900 border-r dark:border-gray-700 sticky left-0 z-30 transition-colors">
                        <div className="h-10 border-b dark:border-gray-700 bg-gray-50 dark:bg-gray-900 transition-colors"></div> {/* Header spacer */}
                        {timeSlots.map(time => (
                            <div key={time} className="h-12 border-b dark:border-gray-700 text-right pr-2 text-xs text-gray-500 dark:text-gray-400 font-mono flex items-center justify-end transition-colors">
                                {time}
                            </div>
                        ))}
                    </div>

                    {/* Days Columns */}
                    <div className="flex-1 flex">
                        {weekDates.map((date, i) => {
                            const dateStr = formatDate(date);
                            const dayBookings = groupedBookings.filter(b => b.date === dateStr);

                            // Calculate Layout for this day
                            const positionedBookings = calculateEventLayout(dayBookings);

                            return (
                                <div key={i} className="flex-1 min-w-[100px] border-r dark:border-gray-700 last:border-0 relative transition-colors">
                                    {/* Day Header */}
                                    <div className="h-10 border-b dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-center font-semibold text-gray-700 dark:text-gray-300 text-sm flex items-center justify-center sticky top-0 z-20 transition-colors">
                                        {displayDate(date)}
                                    </div>

                                    {/* Grid Lines */}
                                    <div className="relative">
                                        {timeSlots.map(time => (
                                            <div key={time} className="h-12 border-b dark:border-gray-700 transition-colors"></div>
                                        ))}

                                        {/* Current Time Indicator */}
                                        {isToday(date) && (
                                            <div
                                                className="absolute w-full border-b-2 border-red-500 z-40 pointer-events-none"
                                                style={{ top: `${getCurrentTimeTop()}px` }}
                                                title="Current Time"
                                            >
                                                <div className="absolute -left-1 -top-[4px] w-2 h-2 bg-red-500 rounded-full"></div>
                                            </div>
                                        )}

                                        {/* Events Overlay */}
                                        {positionedBookings.map(booking => (
                                            <div
                                                key={booking.ids[0]}
                                                className="absolute bg-blue-100 dark:bg-blue-900/50 border border-blue-300 dark:border-blue-700 rounded p-1 text-xs overflow-hidden transition-all hover:z-10 hover:shadow-md cursor-pointer"
                                                style={getEventStyle(booking)}
                                                onClick={() => onBookingClick && onBookingClick(booking)}
                                                title="Click to edit booking"
                                            >
                                                <div className="font-bold text-blue-900 dark:text-blue-100 truncate pointer-events-none">{booking.tool_name}</div>
                                                <div className="text-blue-700 dark:text-blue-300 truncate text-[10px] pointer-events-none">{booking.project}</div>
                                                <div className="text-blue-600 dark:text-blue-400 text-[10px] pointer-events-none">{booking.startTime} - {booking.endTime}</div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default UserBookingsCalendar;
