import React, { useState, useEffect, useMemo, useCallback, useRef, Suspense, lazy } from 'react';
import { supabase } from '../supabaseClient';
import logo from '../assets/ktu_mmi.svg';
import { LAB_TIMEZONE, formatLocalDate } from '../utils/bookingUtils';
import BookingModal from './BookingModal';
import ConfirmModal from './ConfirmModal';
import ToolList from './ToolList';
import BookingList from './BookingList';
import UserBookingsCalendar from './UserBookingsCalendar';
import LoadingSpinner from './LoadingSpinner';
import { useToast } from '../context/useToast';
import { useTheme } from '../context/useTheme';

// Code split admin-heavy UserManagement component (P4)
const UserManagement = lazy(() => import('./UserManagement'));

/**
 * Computes SHA-256 in hex format in browser
 */
async function computeSha256(message) {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

const Dashboard = ({ user, profile, onLogout, onProfileRefresh }) => {
    const [activeTab, setActiveTab] = useState('dashboard');
    const [tools, setTools] = useState([]);
    const [bookings, setBookings] = useState([]);
    const [hasCalendarToken, setHasCalendarToken] = useState(false);

    const [selectedTool, setSelectedTool] = useState(null);
    const [initialDate, setInitialDate] = useState(null);
    const [targetBooking, setTargetBooking] = useState(null);

    const [loading, setLoading] = useState(true);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [confirmModalOpen, setConfirmModalOpen] = useState(false);
    const [bookingIdToCancel, setBookingIdToCancel] = useState(null);
    const [sendCancellationMessage, setSendCancellationMessage] = useState(false);
    const [isCancelling, setIsCancelling] = useState(false);

    // Filters for "All Bookings" (Admin)
    const [filterStartDate, setFilterStartDate] = useState('');
    const [filterEndDate, setFilterEndDate] = useState('');
    const [filterUserName, setFilterUserName] = useState('');
    const [filterToolId, setFilterToolId] = useState('');

    // Week State (Monday as start of week)
    const [currentWeekStart, setCurrentWeekStart] = useState(() => {
        const d = new Date();
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1);
        d.setDate(diff);
        d.setHours(0, 0, 0, 0);
        return d;
    });

    const { showToast } = useToast();
    const { theme, toggleTheme } = useTheme();
    const querySeqRef = useRef(0);

    // Bounded Fetch Data (P1): fetch tools and relevant bookings window
    const fetchData = useCallback(async (isBackground = false) => {
        const currentSeq = ++querySeqRef.current;
        if (!isBackground) setLoading(true);

        try {
            // Calculate date window around visible week (-7 days to +14 days)
            const windowStart = new Date(currentWeekStart);
            windowStart.setDate(windowStart.getDate() - 7);
            const windowEnd = new Date(currentWeekStart);
            windowEnd.setDate(windowEnd.getDate() + 14);

            const startStr = formatLocalDate(windowStart);
            const endStr = formatLocalDate(windowEnd);

            // Fetch tools and bookings concurrently
            const [toolsRes, bookingsRes, tokenRes] = await Promise.all([
                supabase
                    .from('tools')
                    .select('id, name, category, status, location, license_req, description')
                    .order('id', { ascending: true }),

                // Query bookings bounded to the active window or user's bookings
                supabase
                    .from('bookings')
                    .select('id, tool_id, tool_name, user_id, user_name, project, date, time, end_time, starts_at, ends_at, created_at')
                    .or(`and(date.gte.${startStr},date.lte.${endStr}),user_id.eq.${user.id}`)
                    .order('date', { ascending: true })
                    .order('time', { ascending: true }),

                supabase.rpc('has_calendar_token')
            ]);

            // If a newer query resolved already, discard this response
            if (currentSeq !== querySeqRef.current) return;

            if (toolsRes.error) throw toolsRes.error;
            if (bookingsRes.error) throw bookingsRes.error;

            if (toolsRes.data) setTools(toolsRes.data);
            if (bookingsRes.data) setBookings(bookingsRes.data);
            if (!tokenRes.error && tokenRes.data !== undefined) {
                setHasCalendarToken(Boolean(tokenRes.data));
            }

        } catch (error) {
            if (currentSeq !== querySeqRef.current) return;
            console.error('Error fetching dashboard data:', error);
            if (!isBackground) {
                showToast('Error loading bookings: ' + error.message, 'error');
            }
        } finally {
            if (!isBackground && currentSeq === querySeqRef.current) {
                setLoading(false);
            }
        }
    }, [currentWeekStart, user.id, showToast]);

    // Initial fetch and hidden-tab aware polling (P1)
    useEffect(() => {
        fetchData();

        const handleVisibilityChange = () => {
            if (!document.hidden) {
                fetchData(true);
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);

        const intervalId = setInterval(() => {
            if (!document.hidden) {
                fetchData(true);
            }
        }, 15000); // 15 seconds polling when active

        return () => {
            clearInterval(intervalId);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [fetchData]);

    // Filter user's personal bookings
    const myBookings = useMemo(() => {
        return bookings.filter(b => b.user_id === user.id);
    }, [bookings, user.id]);

    // Quick Book: 3 most recently used tools by user
    const recentTools = useMemo(() => {
        const uniqueToolIds = new Set();
        const recent = [];
        const sorted = [...myBookings].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

        for (const booking of sorted) {
            if (!uniqueToolIds.has(booking.tool_id)) {
                uniqueToolIds.add(booking.tool_id);
                const tool = tools.find(t => t.id === booking.tool_id);
                if (tool) recent.push(tool);
            }
            if (recent.length >= 3) break;
        }
        return recent;
    }, [myBookings, tools]);

    // Filtered bookings for Admin View
    const filteredAllBookings = useMemo(() => {
        if (!bookings) return [];
        let result = bookings;

        if (filterStartDate) {
            result = result.filter(b => b.date >= filterStartDate);
        }
        if (filterEndDate) {
            result = result.filter(b => b.date <= filterEndDate);
        }
        if (filterUserName) {
            const lowerFilter = filterUserName.toLowerCase();
            result = result.filter(b =>
                (b.user_name && b.user_name.toLowerCase().includes(lowerFilter))
            );
        }
        if (filterToolId) {
            result = result.filter(b => String(b.tool_id) === String(filterToolId));
        }
        return result;
    }, [bookings, filterStartDate, filterEndDate, filterUserName, filterToolId]);

    // Explicit mutation results for booking creation (L5)
    const handleBookTool = async (bookingData) => {
        const newBookings = Array.isArray(bookingData) ? bookingData : [bookingData];

        const now = new Date();
        const hasPastBooking = newBookings.some(b => {
            const bookingEnd = new Date(`${b.date}T${b.end_time || b.endTime}`);
            return bookingEnd < now;
        });

        const isAdminOverride = profile?.access_level === 'admin' && activeTab === 'all_bookings';

        if (hasPastBooking && !isAdminOverride) {
            showToast('Cannot create bookings in the past.', 'error');
            return { success: false, error: 'Cannot create bookings in the past' };
        }

        try {
            const { data, error } = await supabase
                .from('bookings')
                .insert(newBookings)
                .select();

            if (error) throw error;
            if (!data || data.length === 0) {
                throw new Error('No booking record was created');
            }

            setBookings(prev => [...prev, ...data]);
            setSelectedTool(null);
            setInitialDate(null);
            showToast(`Successfully created ${data.length} reservation(s).`, 'success');
            return { success: true, data };
        } catch (error) {
            console.error('Error creating booking:', error);
            const msg = error.message?.includes('no_double_booking')
                ? 'Collision detected: Another reservation was made for this time slot.'
                : ('Failed to create booking: ' + (error.message || 'Unknown error'));
            showToast(msg, 'error');
            return { success: false, error: msg };
        }
    };

    // Explicit mutation results for booking update (L1, L5)
    const handleUpdateBooking = async (oldIds, newBookingData) => {
        try {
            const bookingId = oldIds[0];
            if (!bookingId) throw new Error("No booking ID provided for update");

            const bookingsToProcess = Array.isArray(newBookingData) ? newBookingData : [newBookingData];
            const newBooking = bookingsToProcess[0];

            const now = new Date();
            const bookingEnd = new Date(`${newBooking.date}T${newBooking.end_time || newBooking.endTime}`);
            const isAdminOverride = profile?.access_level === 'admin' && activeTab === 'all_bookings';

            if (bookingEnd < now && !isAdminOverride) {
                throw new Error('Cannot move booking to the past.');
            }

            const startTime = (newBooking.startTime || newBooking.time).slice(0, 5);
            const endTime = (newBooking.endTime || newBooking.end_time).slice(0, 5);
            const project = newBooking.project || 'General Research';

            // Attempt atomic RPC update first (guarantees transactional rollback if collision)
            const { data: rpcData, error: rpcError } = await supabase.rpc('update_booking_group', {
                p_old_ids: oldIds,
                p_date: newBooking.date,
                p_start_time: startTime,
                p_end_time: endTime,
                p_project: project
            });

            if (rpcError) {
                // If RPC fails with specific error (e.g. exclusion violation)
                throw rpcError;
            }

            // Successfully updated via RPC
            const updatedRow = rpcData || {
                id: bookingId,
                date: newBooking.date,
                time: startTime,
                end_time: endTime,
                project
            };

            setBookings(prev => {
                const secondaryIds = oldIds.slice(1);
                const filtered = secondaryIds.length > 0 ? prev.filter(b => !secondaryIds.includes(b.id)) : prev;
                return filtered.map(b => b.id === bookingId ? { ...b, ...updatedRow } : b);
            });

            showToast("Booking updated successfully.", 'success');
            return { success: true };
        } catch (error) {
            console.error('Error updating booking:', error);
            const msg = error.message?.includes('no_double_booking')
                ? 'Time slot is already reserved by another booking.'
                : ('Failed to update booking: ' + (error.message || 'Unknown error'));
            showToast(msg, 'error');
            return { success: false, error: msg };
        }
    };

    const initiateCancel = (ids) => {
        const idsToCheck = Array.isArray(ids) ? ids : [ids];
        const bookingsToCheck = bookings.filter(b => idsToCheck.includes(b.id));

        const now = new Date();
        const hasInProgress = bookingsToCheck.some(b => {
            const start = new Date(`${b.date}T${b.time}`);
            const end = new Date(`${b.date}T${b.end_time}`);
            return start <= now && end > now;
        });

        const isAdminOverride = profile?.access_level === 'admin' && activeTab === 'all_bookings';

        if (hasInProgress && !isAdminOverride) {
            showToast('Cannot cancel an in-progress booking.', 'error');
            return;
        }

        setBookingIdToCancel(ids);
        setSendCancellationMessage(false);
        setConfirmModalOpen(true);
    };

    const handleConfirmCancel = async () => {
        if (!bookingIdToCancel) return;

        setIsCancelling(true);
        const idsToCancel = Array.isArray(bookingIdToCancel) ? bookingIdToCancel : [bookingIdToCancel];

        try {
            const bookingsToDelete = bookings.filter(b => idsToCancel.includes(b.id));

            const { error } = await supabase
                .from('bookings')
                .delete()
                .in('id', idsToCancel);

            if (error) throw error;

            setBookings(prev => prev.filter(b => !idsToCancel.includes(b.id)));
            showToast("Booking has been cancelled.", 'success');

            // Send cancellation notification if requested (S4, P3)
            if (sendCancellationMessage && bookingsToDelete.length > 0) {
                const booking = bookingsToDelete[0];
                const { data, error: notifyError } = await supabase.functions.invoke('notify-cancellation', {
                    body: {
                        toolId: booking.tool_id,
                        toolName: booking.tool_name,
                        bookingDate: booking.date,
                        bookingTime: booking.time,
                    }
                });

                if (notifyError) {
                    console.error('Error invoking notify-cancellation:', notifyError);
                    showToast('Booking cancelled, but failed to send notifications.', 'warning');
                } else if (data?.count > 0) {
                    showToast(`Cancellation notification sent to ${data.count} licensed user(s).`, 'success');
                } else {
                    showToast('Booking cancelled. No other licensed users were eligible to notify.');
                }
            }

        } catch (error) {
            console.error('Error cancelling booking:', error);
            showToast('Failed to cancel booking: ' + error.message, 'error');
        } finally {
            setIsCancelling(false);
            setConfirmModalOpen(false);
            setBookingIdToCancel(null);
        }
    };

    const handleStatusChange = async (toolId, newStatus) => {
        try {
            const { error } = await supabase
                .from('tools')
                .update({ status: newStatus })
                .eq('id', toolId);

            if (error) throw error;

            setTools(prev => prev.map(t => t.id === toolId ? { ...t, status: newStatus } : t));
            showToast(`Tool status updated to ${newStatus}`, 'success');
        } catch (error) {
            console.error('Error updating tool status:', error);
            showToast('Failed to update status: ' + error.message, 'error');
        }
    };

    const handleBookingClick = (booking) => {
        const tool = tools.find(t => t.id === booking.tool_id);
        if (tool) {
            setSelectedTool(tool);
            setInitialDate(booking.date);
            setTargetBooking(booking);
        } else {
            showToast('Tool details not found.', 'error');
        }
    };

    // Calendar bearer token creation & rotation (S2)
    const handleGenerateOrRotateCalendar = async (isReset = false) => {
        if (isReset && !confirm('Are you sure you want to reset your calendar link? Any previously synced calendar apps will stop updating until you supply the new link.')) {
            return;
        }

        try {
            // Generate high-entropy bearer token
            const rawToken = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
            const tokenHash = await computeSha256(rawToken);

            // Store hash in dedicated table via protected RPC
            const { error } = await supabase.rpc('rotate_calendar_token', {
                p_token_hash: tokenHash
            });

            if (error) throw error;

            setHasCalendarToken(true);
            const calendarUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/serve-ics?token=${rawToken}`;
            await navigator.clipboard.writeText(calendarUrl);

            showToast(isReset ? 'Calendar link reset and copied to clipboard!' : 'Calendar link copied to clipboard!', 'success');
        } catch (err) {
            console.error('Failed to configure calendar link:', err);
            showToast('Failed to generate calendar link: ' + (err.message || 'Unknown error'), 'error');
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-screen bg-gray-100 dark:bg-gray-900 transition-colors">
                <LoadingSpinner />
            </div>
        );
    }

    const handleNavigation = (tabName) => {
        setActiveTab(tabName);
        setIsSidebarOpen(false);
    };

    return (
        <div className="flex h-screen bg-gray-100 dark:bg-gray-900 transition-colors">
            {/* Mobile Sidebar Overlay */}
            {isSidebarOpen && (
                <div
                    className="fixed inset-0 bg-black/50 z-40 lg:hidden"
                    onClick={() => setIsSidebarOpen(false)}
                ></div>
            )}

            {/* Sidebar */}
            <div className={`fixed inset-y-0 left-0 z-50 w-64 bg-white dark:bg-gray-800 shadow-lg flex flex-col transition-transform duration-300 ease-in-out lg:translate-x-0 lg:static lg:inset-auto ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
                <div className="h-16 flex items-center justify-center border-b border-blue-900 lims-header transition-colors">
                    <div className="font-bold text-xl tracking-wider flex items-center">
                        <img src={logo} alt="Logo" className="h-8 mr-2 brightness-0 invert" />
                        MMI-LIMS
                    </div>
                </div>

                <div className="p-4 border-b dark:border-gray-700">
                    <div className="text-sm text-gray-500 dark:text-gray-400">Logged in as</div>
                    <div className="font-bold text-gray-800 dark:text-gray-200 truncate">
                        {profile ? `${profile.first_name || ''} ${profile.last_name || ''}`.trim() : user.email}
                    </div>
                    <div className="text-xs text-blue-600 dark:text-blue-400 font-semibold uppercase mt-1">
                        {profile?.job_title || 'Researcher'}
                        {profile?.access_level === 'admin' && <span className="ml-2 bg-red-600 text-white px-1 rounded text-[10px]">ADMIN</span>}
                    </div>
                    <div className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">
                        Timezone: <span className="font-medium text-gray-600 dark:text-gray-300">{LAB_TIMEZONE}</span>
                    </div>
                </div>

                {/* Navigation Links */}
                <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
                    <button
                        onClick={() => handleNavigation('dashboard')}
                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition ${activeTab === 'dashboard' ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-bold' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
                    >
                        <i className="fas fa-calendar-alt w-5 text-center"></i>
                        My Dashboard
                    </button>
                    <button
                        onClick={() => handleNavigation('tools')}
                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition ${activeTab === 'tools' ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-bold' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
                    >
                        <i className="fas fa-microscope w-5 text-center"></i>
                        Equipment List
                    </button>

                    {profile?.access_level === 'admin' && (
                        <>
                            <div className="pt-4 pb-1">
                                <div className="px-4 text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                                    Administration
                                </div>
                            </div>
                            <button
                                onClick={() => handleNavigation('all_bookings')}
                                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition ${activeTab === 'all_bookings' ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-bold' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
                            >
                                <i className="fas fa-list-alt w-5 text-center"></i>
                                All Bookings
                            </button>
                            <button
                                onClick={() => handleNavigation('users')}
                                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition ${activeTab === 'users' ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-bold' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
                            >
                                <i className="fas fa-users-cog w-5 text-center"></i>
                                User Management
                            </button>
                        </>
                    )}
                </nav>

                <div className="p-4 border-t dark:border-gray-700 space-y-2">
                    <button
                        onClick={toggleTheme}
                        className="w-full flex items-center justify-between px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg transition"
                    >
                        <span>Dark Theme</span>
                        <i className={`fas ${theme === 'dark' ? 'fa-moon text-blue-400' : 'fa-sun text-yellow-500'}`}></i>
                    </button>
                    <button
                        onClick={onLogout}
                        className="w-full flex items-center gap-3 px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition"
                    >
                        <i className="fas fa-sign-out-alt w-5 text-center"></i>
                        Sign Out
                    </button>
                </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 flex flex-col overflow-hidden">
                {/* Mobile Header */}
                <header className="h-16 bg-white dark:bg-gray-800 border-b dark:border-gray-700 flex items-center justify-between px-4 lg:hidden">
                    <button
                        onClick={() => setIsSidebarOpen(true)}
                        className="p-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
                    >
                        <i className="fas fa-bars text-xl"></i>
                    </button>
                    <span className="font-bold text-lg text-gray-800 dark:text-gray-200">MMI-LIMS</span>
                    <div className="w-8"></div>
                </header>

                <main className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">
                    {/* TAB: DASHBOARD */}
                    {activeTab === 'dashboard' && (
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-full">
                            {/* Left Column: My Bookings Calendar */}
                            <div className="lg:col-span-2 flex flex-col">
                                <div className="flex justify-between items-center mb-4">
                                    <div>
                                        <h3 className="font-bold text-gray-800 dark:text-gray-200">My Bookings Calendar</h3>
                                        <span className="text-xs text-gray-500 dark:text-gray-400">Lab timezone: {LAB_TIMEZONE}</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={() => handleGenerateOrRotateCalendar(false)}
                                            className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 flex items-center gap-2 transition-colors px-2 py-1 rounded hover:bg-blue-50 dark:hover:bg-blue-900/20"
                                            title="Copy calendar subscription feed URL (ICS)"
                                        >
                                            <i className="fas fa-sync-alt"></i> Sync Calendar
                                        </button>
                                        {hasCalendarToken && (
                                            <button
                                                onClick={() => handleGenerateOrRotateCalendar(true)}
                                                className="text-sm text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 flex items-center gap-1 transition-colors px-2 py-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20"
                                                title="Reset calendar subscription link"
                                            >
                                                <i className="fas fa-redo"></i> Reset
                                            </button>
                                        )}
                                    </div>
                                </div>
                                <UserBookingsCalendar
                                    bookings={myBookings}
                                    allBookings={bookings}
                                    onUpdate={handleUpdateBooking}
                                    currentWeekStart={currentWeekStart}
                                    onWeekChange={setCurrentWeekStart}
                                    onBookingClick={handleBookingClick}
                                />
                            </div>

                            {/* Right Column: Quick Book, Upcoming & Past Bookings */}
                            <div className="lg:col-span-1 flex flex-col gap-6">
                                {/* Quick Book */}
                                <div className="flex flex-col">
                                    <h3 className="font-bold text-gray-800 dark:text-gray-200 mb-4">Quick Book</h3>
                                    <div className="card max-h-[350px] flex flex-col p-0">
                                        <div className="overflow-y-auto p-4 custom-scroll">
                                            {recentTools.length > 0 ? (
                                                <div className="grid grid-cols-1 gap-4">
                                                    {recentTools.map(tool => (
                                                        <div
                                                            key={tool.id}
                                                            className="bg-gray-50 dark:bg-gray-900 p-3 rounded-lg border dark:border-gray-700 hover:shadow-md transition cursor-pointer flex justify-between items-center group"
                                                            onClick={() => setSelectedTool(tool)}
                                                        >
                                                            <div>
                                                                <div className="font-bold text-sm text-gray-800 dark:text-gray-200 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                                                                    {tool.name}
                                                                </div>
                                                                <div className="text-xs text-gray-500 dark:text-gray-400">{tool.category}</div>
                                                            </div>
                                                            <div className="h-6 w-6 bg-white dark:bg-gray-800 rounded-full flex items-center justify-center text-blue-600 dark:text-blue-400 group-hover:bg-blue-100 dark:group-hover:bg-blue-800/50 transition-colors shadow-sm">
                                                                <i className="fas fa-plus text-xs"></i>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            ) : (
                                                <div className="flex items-center justify-center text-gray-400 italic py-4">
                                                    No recent equipment reservations found.
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* Upcoming Bookings */}
                                <div className="flex flex-col">
                                    <h3 className="font-bold text-gray-800 dark:text-gray-200 mb-4">Upcoming Bookings</h3>
                                    <div className="card max-h-[350px] flex flex-col p-0">
                                        <div className="overflow-y-auto p-4 custom-scroll">
                                            <BookingList
                                                bookings={myBookings.filter(b => {
                                                    const end = new Date(`${b.date}T${b.end_time || b.endTime || '23:59'}`);
                                                    return !isNaN(end.getTime()) && end >= new Date();
                                                })}
                                                allBookings={bookings}
                                                onCancel={initiateCancel}
                                                onUpdate={handleUpdateBooking}
                                                onEdit={handleBookingClick}
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* Past Bookings */}
                                <div className="flex flex-col">
                                    <h3 className="font-bold text-gray-600 dark:text-gray-400 mb-4">Past Bookings</h3>
                                    <div className="bg-gray-50 dark:bg-gray-900 rounded-lg shadow-sm border dark:border-gray-700 transition-colors flex flex-col max-h-[350px]">
                                        <div className="overflow-y-auto p-4 custom-scroll">
                                            <BookingList
                                                bookings={myBookings.filter(b => {
                                                    const end = new Date(`${b.date}T${b.end_time || b.endTime || '00:00'}`);
                                                    return !isNaN(end.getTime()) && end < new Date();
                                                })}
                                                allBookings={bookings}
                                                onCancel={initiateCancel}
                                                onUpdate={handleUpdateBooking}
                                                onEdit={handleBookingClick}
                                                readOnly={true}
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* TAB: TOOLS */}
                    {activeTab === 'tools' && (
                        <ToolList
                            tools={tools}
                            profile={profile}
                            onStatusChange={handleStatusChange}
                            onBook={setSelectedTool}
                        />
                    )}

                    {/* TAB: ALL BOOKINGS (ADMIN ONLY) */}
                    {activeTab === 'all_bookings' && profile?.access_level === 'admin' && (
                        <div>
                            <h3 className="font-bold text-gray-800 dark:text-gray-200 mb-4">All Bookings List</h3>

                            <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-sm border dark:border-gray-700 mb-4 grid grid-cols-1 md:grid-cols-4 gap-4 transition-colors">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Start Date</label>
                                    <input
                                        type="date"
                                        className="w-full border border-gray-300 dark:border-gray-600 rounded p-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        value={filterStartDate}
                                        onChange={(e) => setFilterStartDate(e.target.value)}
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">End Date</label>
                                    <input
                                        type="date"
                                        className="w-full border border-gray-300 dark:border-gray-600 rounded p-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        value={filterEndDate}
                                        onChange={(e) => setFilterEndDate(e.target.value)}
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">User Name</label>
                                    <input
                                        type="text"
                                        className="w-full border border-gray-300 dark:border-gray-600 rounded p-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        placeholder="Filter by user..."
                                        value={filterUserName}
                                        onChange={(e) => setFilterUserName(e.target.value)}
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Tool</label>
                                    <select
                                        className="w-full border border-gray-300 dark:border-gray-600 rounded p-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        value={filterToolId}
                                        onChange={(e) => setFilterToolId(e.target.value)}
                                    >
                                        <option value="">All Tools</option>
                                        {tools.map(t => (
                                            <option key={t.id} value={t.id}>{t.name}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <div className="card p-4">
                                <BookingList
                                    bookings={filteredAllBookings}
                                    onCancel={initiateCancel}
                                    onUpdate={handleUpdateBooking}
                                    onEdit={handleBookingClick}
                                    isAdminView={true}
                                />
                            </div>
                        </div>
                    )}

                    {/* TAB: USERS (ADMIN ONLY - Lazy Loaded) */}
                    {activeTab === 'users' && profile?.access_level === 'admin' && (
                        <Suspense fallback={<div className="p-8 text-center"><LoadingSpinner /></div>}>
                            <UserManagement
                                tools={tools}
                                currentUser={user}
                                onProfileUpdate={onProfileRefresh}
                            />
                        </Suspense>
                    )}
                </main>
            </div>

            {selectedTool && (
                <BookingModal
                    tool={selectedTool}
                    user={user}
                    profile={profile}
                    existingBookings={bookings}
                    initialDate={initialDate}
                    initialBooking={targetBooking}
                    onClose={() => { setSelectedTool(null); setInitialDate(null); setTargetBooking(null); }}
                    onConfirm={handleBookTool}
                    onUpdate={handleUpdateBooking}
                    onCancel={initiateCancel}
                    isAdminOverride={profile?.access_level === 'admin' && activeTab === 'all_bookings'}
                />
            )}

            <ConfirmModal
                isOpen={confirmModalOpen}
                title="Cancel Booking"
                message="Are you sure you want to cancel this booking? This action cannot be undone."
                onConfirm={handleConfirmCancel}
                onCancel={() => { setConfirmModalOpen(false); setBookingIdToCancel(null); }}
                showCheckbox={true}
                checkboxLabel="Send cancellation message to licensed users"
                isCheckboxChecked={sendCancellationMessage}
                onCheckboxChange={setSendCancellationMessage}
                isLoading={isCancelling}
            />
        </div>
    );
};

export default Dashboard;
