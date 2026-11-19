import React, { useMemo } from 'react';
import { parseCalendarDate } from '../utils/bookingUtils';

const AnalyticsCharts = ({ bookings, currentWeekStart }) => {
    const weeklyData = useMemo(() => {
        if (!currentWeekStart) return [];

        const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        const counts = new Array(7).fill(0);

        const startOfWeek = parseCalendarDate(currentWeekStart);
        startOfWeek.setHours(0, 0, 0, 0);

        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 6);
        endOfWeek.setHours(23, 59, 59, 999);

        bookings.forEach(booking => {
            if (!booking?.date) return;
            const bookingDate = parseCalendarDate(booking.date);
            // Check if booking is within current week
            if (bookingDate >= startOfWeek && bookingDate <= endOfWeek) {
                // Get day index (0 = Mon, ..., 6 = Sun)
                let dayIndex = bookingDate.getDay() - 1;
                if (dayIndex === -1) dayIndex = 6; // Sunday

                if (dayIndex >= 0 && dayIndex < 7) {
                    counts[dayIndex]++;
                }
            }
        });

        const maxCount = Math.max(...counts, 1);

        return days.map((day, index) => ({
            day,
            label: day,
            count: counts[index],
            height: (counts[index] / maxCount) * 100
        }));
    }, [bookings, currentWeekStart]);

    return (
        <div className="bg-white dark:bg-gray-800 p-4 sm:p-6 rounded-lg shadow-sm border dark:border-gray-700 transition-colors">
            {/* <h3 className="text-gray-500 dark:text-gray-400 text-sm font-bold uppercase mb-4">Bookings this Week</h3> */}
            <div className="flex justify-between h-32 pt-7 gap-2">
                {weeklyData.map((d, i) => (
                    <div key={i} className="flex flex-col items-center flex-1 h-full justify-end group">
                        <div className="relative w-full flex justify-center items-end flex-1">
                            <div
                                role="img"
                                tabIndex={0}
                                aria-label={`${d.label}: ${d.count} bookings`}
                                className="w-full max-w-[30px] bg-blue-600 dark:bg-blue-500 rounded-t transition-all group-hover:bg-blue-700 dark:group-hover:bg-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500 relative"
                                style={{ height: `${d.height}%` }}
                            >
                                <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-gray-800 dark:bg-gray-900 text-white text-xs py-0.5 px-1.5 rounded opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 transition-opacity pointer-events-none whitespace-nowrap">
                                    {d.count}
                                </div>
                            </div>
                        </div>
                        <div className="text-xs text-gray-400 mt-2 font-medium">{d.day}</div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default AnalyticsCharts;
