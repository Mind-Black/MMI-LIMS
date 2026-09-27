import React, { useState, useEffect, useMemo, useCallback, useRef, Suspense, lazy } from 'react';
import { supabase } from '../supabaseClient';
import logo from '../assets/ktu_mmi.svg';
import {
    LAB_TIMEZONE,
    formatLocalDate,
    getMonday,
    addDays,
    isBookingPast,
    isBookingInProgress
} from '../utils/bookingUtils';
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
    const [userBookings, setUserBookings] = useState([]);
    const [adminBookings, setAdminBookings] = useState([]);
    const [loadingAdminBookings, setLoadingAdminBookings] = useState(false);
    const [hasCalendarToken, setHasCalendarToken] = useState(false);

    // Calendar sync modal state (R12)
    const [calendarModalOpen, setCalendarModalOpen] = useState(false);
    const [calendarUrl, setCalendarUrl] = useState('');
    const [isGeneratingToken, setIsGeneratingToken] = useState(false);
    const [copyState, setCopyState] = useState({ copied: false, failed: false });

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

    // Week State (Monday as start of week without timezone distortion - Fixes R6)
    const [currentWeekStart, setCurrentWeekStart] = useState(() => getMonday(new Date()));

    const { showToast } = useToast();
    const { theme, toggleTheme } = useTheme();
    const querySeqRef = useRef(0);
    const isFetchingRef = useRef(false);

    // Bounded Fetch Data (Fixes R5, R10): separate calendar window from user history
    const fetchData = useCallback(async (isBackground = false) => {
        if (isFetchingRef.current) return;
        isFetchingRef.current = true;
        const currentSeq = ++querySeqRef.current;
        if (!isBackground) setLoading(true);

        try {
            // Calculate date window around visible week (-7 days to +14 days)
            const windowStart = addDays(currentWeekStart, -7);
            const windowEnd = addDays(currentWeekStart, 14);
            const startStr = formatLocalDate(windowStart);
            const endStr = formatLocalDate(windowEnd);

            // User history cutoff: last 60 days
            const userHistoryCutoff = formatLocalDate(addDays(new Date(), -60));

            // Fetch tools, calendar window bookings, user bookings, and calendar token status concurrently
            const [toolsRes, bookingsRes, userBookingsRes, tokenRes] = await Promise.all([
                supabase
                    .from('tools')
                    .select('id, name, category, status, location, license_req, description')
                    .order('id', { ascending: true }),

                // Calendar window bookings (all users)
                supabase
                    .from('bookings')
                    .select('id, tool_id, tool_name, user_id, user_name, project, date, time, end_time, starts_at, ends_at, created_at')
                    .gte('date', startStr)
                    .lte('date', endStr)
                    .order('date', { ascending: true })
                    .order('time', { ascending: true })
                    .limit(1000),

                // User's own bookings across a wider window for the My Bookings tab
                supabase
                    .from('bookings')
                    .select('id, tool_id, tool_name, user_id, user_name, project, date, time, end_time, starts_at, ends_at, created_at')
                    .eq('user_id', user.id)
                    .gte('date', userHistoryCutoff)
                    .order('date', { ascending: true })
                    .order('time', { ascending: true })
                    .limit(500),

                supabase.rpc('has_calendar_token')
            ]);

            // If a newer query resolved already, discard this response
            if (currentSeq !== querySeqRef.current) return;

            if (toolsRes.error) throw toolsRes.error;
            if (bookingsRes.error) throw bookingsRes.error;
            if (userBookingsRes.error) throw userBookingsRes.error;

            if (toolsRes.data) setTools(toolsRes.data);
            if (bookingsRes.data) setBookings(bookingsRes.data);
            if (userBookingsRes.data) setUserBookings(userBookingsRes.data);
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
            isFetchingRef.current = false;
            // Always clear loading if this was the latest sequence (Fixes R10)
            if (currentSeq === querySeqRef.current) {
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

    // User's personal bookings (Fixes R5)
    const myBookings = userBookings;

    // Combined bookings for the calendar grid (merges visible window + user bookings)
    const allCalendarBookings = useMemo(() => {
        const map = new Map();
        for (const b of bookings) {
            map.set(b.id, b);
        }
        for (const b of userBookings) {
            map.set(b.id, b);
        }
        return Array.from(map.values());
    }, [bookings, userBookings]);

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

    // Server-side filtered query for Admin "All Bookings" tab (Fixes R5)
    const fetchAdminBookings = useCallback(async () => {
        if (profile?.access_level !== 'admin') return;
        setLoadingAdminBookings(true);
        try {
            let query = supabase
                .from('bookings')
                .select('id, tool_id, tool_name, user_id, user_name, project, date, time, end_time, starts_at, ends_at, created_at')
                .order('date', { ascending: false })
                .order('time', { ascending: false })
                .limit(200);

            if (filterStartDate) {
                query = query.gte('date', filterStartDate);
            }
            if (filterEndDate) {
                query = query.lte('date', filterEndDate);
            }
            if (filterUserName.trim()) {
                query = query.ilike('user_name', `%${filterUserName.trim()}%`);
            }
            if (filterToolId) {
                query = query.eq('tool_id', filterToolId);
            }

            const { data, error } = await query;
            if (error) throw error;
            setAdminBookings(data || []);
        } catch (err) {
            console.error('Error fetching admin bookings:', err);
            showToast('Error loading all bookings: ' + err.message, 'error');
        } finally {
            setLoadingAdminBookings(false);
        }
    }, [profile?.access_level, filterStartDate, filterEndDate, filterUserName, filterToolId, showToast]);

    useEffect(() => {
        if (activeTab === 'all_bookings' && profile?.access_level === 'admin') {
            fetchAdminBookings();
        }
    }, [activeTab, profile?.access_level, fetchAdminBookings]);

    // Explicit mutation results for booking creation (L5, R6)
    const handleBookTool = async (bookingData) => {
        const newBookings = Array.isArray(bookingData) ? bookingData : [bookingData];

        const hasPastBooking = newBookings.some(b => isBookingPast(b));
        const isAdminOverride = profile?.access_level === 'admin' && activeTab === 'all_bookings';

        if (hasPastBooking && !isAdminOverride) {
            showToast('Cannot create bookings in the past.', 'error');
            return { success: false, error: 'Cannot create bookings in the past' };
        }

        try {
            querySeqRef.current++; // Invalidate in-flight reads
            const { data, error } = await supabase
                .from('bookings')
                .insert(newBookings)
                .select();

            if (error) throw error;
            if (!data || data.length === 0) {
                throw new Error('No booking record was created');
            }

            setBookings(prev => [...prev, ...data]);
            setUserBookings(prev => [...prev, ...data]);
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

    // Explicit mutation results for booking update (L1, L5, R6)
    const handleUpdateBooking = async (oldIds, newBookingData) => {
        try {
            const bookingId = oldIds[0];
            if (!bookingId) throw new Error("No booking ID provided for update");

            const bookingsToProcess = Array.isArray(newBookingData) ? newBookingData : [newBookingData];
            const newBooking = bookingsToProcess[0];

            const isAdminOverride = profile?.access_level === 'admin' && activeTab === 'all_bookings';

            if (isBookingPast(newBooking) && !isAdminOverride) {
                throw new Error('Cannot move booking to the past.');
            }

            const startTime = (newBooking.startTime || newBooking.time).slice(0, 5);
            const endTime = (newBooking.endTime || newBooking.end_time).slice(0, 5);
            const project = newBooking.project || 'General Research';

            querySeqRef.current++; // Invalidate in-flight reads

            // Attempt atomic RPC update first (guarantees transactional rollback if collision)
            const { data: rpcData, error: rpcError } = await supabase.rpc('update_booking_group', {
                p_old_ids: oldIds,
                p_date: newBooking.date,
                p_start_time: startTime,
                p_end_time: endTime,
                p_project: project
            });

            if (rpcError) {
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

            const updater = prev => {
                const secondaryIds = oldIds.slice(1);
                const filtered = secondaryIds.length > 0 ? prev.filter(b => !secondaryIds.includes(b.id)) : prev;
                return filtered.map(b => b.id === bookingId ? { ...b, ...updatedRow } : b);
            };

            setBookings(updater);
            setUserBookings(updater);
            setAdminBookings(updater);

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
        const allKnown = [...bookings, ...userBookings];
        const bookingsToCheck = allKnown.filter(b => idsToCheck.includes(b.id));

        const isAdminOverride = profile?.access_level === 'admin' && activeTab === 'all_bookings';

        const hasInProgress = bookingsToCheck.some(b => isBookingInProgress(b));
        if (hasInProgress && !isAdminOverride) {
            showToast('Cannot cancel an in-progress booking.', 'error');
            return;
        }

        const hasPast = bookingsToCheck.some(b => isBookingPast(b));
        if (hasPast && !isAdminOverride) {
            showToast('Cannot cancel a past booking.', 'error');
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
            querySeqRef.current++; // Invalidate in-flight background reads
            let cancelledIds = [];
            let eventIdToNotify = null;

            for (let i = 0; i < idsToCancel.length; i++) {
                const id = idsToCancel[i];
                const shouldNotify = (i === 0 && sendCancellationMessage);

                // Use atomic cancel_booking RPC (creates cancellation_events row atomically and verifies authority)
                const { data: cancelResult, error: rpcError } = await supabase.rpc('cancel_booking', {
                    p_booking_id: id,
                    p_notify_users: shouldNotify
                });

                if (rpcError) {
                    // Fallback to direct DELETE with affected row check if RPC not installed
                    if (rpcError.message?.includes('function') && rpcError.message?.includes('does not exist')) {
                        const { data: delData, error: delError } = await supabase
                            .from('bookings')
                            .delete()
                            .eq('id', id)
                            .select('id');
                        if (delError) throw delError;
                        if (!delData || delData.length === 0) {
                            throw new Error('Cancellation failed or permission denied (0 rows affected)');
                        }
                        cancelledIds.push(id);
                    } else {
                        throw rpcError;
                    }
                } else {
                    cancelledIds.push(id);
                    if (cancelResult?.cancellation_event_id) {
                        eventIdToNotify = cancelResult.cancellation_event_id;
                    }
                }
            }

            if (cancelledIds.length === 0) {
                throw new Error('No bookings were cancelled.');
            }

            setBookings(prev => prev.filter(b => !cancelledIds.includes(b.id)));
            setUserBookings(prev => prev.filter(b => !cancelledIds.includes(b.id)));
            setAdminBookings(prev => prev.filter(b => !cancelledIds.includes(b.id)));
            showToast("Booking has been cancelled.", 'success');

            // Send cancellation notification if requested and authorized event ID exists (Fixes R4)
            if (eventIdToNotify) {
                const { data, error: notifyError } = await supabase.functions.invoke('notify-cancellation', {
                    body: {
                        cancellationEventId: eventIdToNotify
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
            showToast('Failed to cancel booking: ' + (error.message || 'Unknown error'), 'error');
        } finally {
            setIsCancelling(false);
            setConfirmModalOpen(false);
            setBookingIdToCancel(null);
        }
    };

    // Verify affected rows on status change (Fixes R9)
    const handleStatusChange = async (toolId, newStatus) => {
        try {
            const { data, error } = await supabase
                .from('tools')
                .update({ status: newStatus })
                .eq('id', toolId)
                .select('id');

            if (error) throw error;
            if (!data || data.length === 0) {
                throw new Error('Status update failed or permission denied (0 rows affected)');
            }

            setTools(prev => prev.map(t => t.id === toolId ? { ...t, status: newStatus } : t));
            showToast(`Tool status updated to ${newStatus}`, 'success');
        } catch (error) {
            console.error('Error updating tool status:', error);
            showToast('Failed to update status: ' + (error.message || 'Unknown error'), 'error');
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

    // Calendar bearer token creation & rotation with explicit confirmation and clipboard fallback (Fixes R12)
    const handleOpenCalendarModal = () => {
        setCalendarModalOpen(true);
        setCopyState({ copied: false, failed: false });
    };

    const handleGenerateOrRotateCalendar = async (isReset = false) => {
        setIsGeneratingToken(true);
        setCopyState({ copied: false, failed: false });

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
            const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/serve-ics?token=${rawToken}`;
            setCalendarUrl(url);

            try {
                await navigator.clipboard.writeText(url);
                setCopyState({ copied: true, failed: false });
                showToast(isReset ? 'Calendar link reset and copied to clipboard!' : 'Calendar link copied to clipboard!', 'success');
            } catch {
                setCopyState({ copied: false, failed: true });
                showToast('Link generated. Please copy the URL manually below.', 'info');
            }
        } catch (err) {
            console.error('Failed to configure calendar link:', err);
            showToast('Failed to generate calendar link: ' + (err.message || 'Unknown error'), 'error');
        } finally {
            setIsGeneratingToken(false);
        }
    };

    const handleManualCopy = async () => {
        if (!calendarUrl) return;
        try {
            await navigator.clipboard.writeText(calendarUrl);
            setCopyState({ copied: true, failed: false });
            showToast('Copied to clipboard!', 'success');
        } catch {
            setCopyState({ copied: false, failed: true });
            showToast('Please select and copy the URL manually.', 'error');
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
                                            onClick={handleOpenCalendarModal}
                                            className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 flex items-center gap-2 transition-colors px-2 py-1 rounded hover:bg-blue-50 dark:hover:bg-blue-900/20"
                                            title="Subscribe to calendar feed (ICS)"
                                        >
                                            <i className="fas fa-calendar-alt"></i> Sync Calendar
                                        </button>
                                    </div>
                                </div>
                                <UserBookingsCalendar
                                    bookings={myBookings}
                                    allBookings={allCalendarBookings}
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

                                {/* Upcoming Bookings (Fixes R6) */}
                                <div className="flex flex-col">
                                    <h3 className="font-bold text-gray-800 dark:text-gray-200 mb-4">Upcoming Bookings</h3>
                                    <div className="card max-h-[350px] flex flex-col p-0">
                                        <div className="overflow-y-auto p-4 custom-scroll">
                                            <BookingList
                                                bookings={myBookings.filter(b => !isBookingPast(b))}
                                                allBookings={allCalendarBookings}
                                                onCancel={initiateCancel}
                                                onUpdate={handleUpdateBooking}
                                                onEdit={handleBookingClick}
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* Past Bookings (Fixes R6) */}
                                <div className="flex flex-col">
                                    <h3 className="font-bold text-gray-600 dark:text-gray-400 mb-4">Past Bookings</h3>
                                    <div className="bg-gray-50 dark:bg-gray-900 rounded-lg shadow-sm border dark:border-gray-700 transition-colors flex flex-col max-h-[350px]">
                                        <div className="overflow-y-auto p-4 custom-scroll">
                                            <BookingList
                                                bookings={myBookings.filter(b => isBookingPast(b))}
                                                allBookings={allCalendarBookings}
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

                    {/* TAB: ALL BOOKINGS (ADMIN ONLY - Fixes R5) */}
                    {activeTab === 'all_bookings' && profile?.access_level === 'admin' && (
                        <div>
                            <div className="flex justify-between items-center mb-4">
                                <h3 className="font-bold text-gray-800 dark:text-gray-200">All Bookings List</h3>
                                <button
                                    onClick={fetchAdminBookings}
                                    className="btn btn-sm btn-ghost flex items-center gap-1 text-sm"
                                    title="Refresh bookings"
                                >
                                    <i className={`fas fa-sync-alt ${loadingAdminBookings ? 'fa-spin' : ''}`}></i> Refresh
                                </button>
                            </div>

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
                                {loadingAdminBookings ? (
                                    <div className="py-8 flex justify-center"><LoadingSpinner /></div>
                                ) : (
                                    <BookingList
                                        bookings={adminBookings}
                                        allBookings={allCalendarBookings}
                                        onCancel={initiateCancel}
                                        onUpdate={handleUpdateBooking}
                                        onEdit={handleBookingClick}
                                        isAdminView={true}
                                    />
                                )}
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
                    existingBookings={allCalendarBookings}
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

            {/* Calendar Subscription Feed Modal (Fixes R12) */}
            {calendarModalOpen && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-lg w-full p-6 space-y-4">
                        <div className="flex justify-between items-center">
                            <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                                <i className="fas fa-calendar-alt text-blue-600 dark:text-blue-400"></i>
                                Calendar Subscription (ICS Feed)
                            </h3>
                            <button
                                onClick={() => setCalendarModalOpen(false)}
                                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                            >
                                <i className="fas fa-times text-lg"></i>
                            </button>
                        </div>

                        <p className="text-sm text-gray-600 dark:text-gray-300">
                            Subscribe to your personal reservations in Google Calendar, Apple Calendar, or Outlook.
                        </p>

                        {calendarUrl ? (
                            <div className="space-y-3">
                                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">
                                    Your Private Subscription URL:
                                </label>
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        readOnly
                                        value={calendarUrl}
                                        onClick={(e) => e.target.select()}
                                        className="w-full text-xs font-mono bg-gray-50 dark:bg-gray-900 border dark:border-gray-700 rounded px-3 py-2 text-gray-800 dark:text-gray-200 select-all"
                                    />
                                    <button
                                        onClick={handleManualCopy}
                                        className="btn btn-primary btn-sm flex items-center gap-1 whitespace-nowrap"
                                    >
                                        <i className="fas fa-copy"></i> Copy
                                    </button>
                                </div>

                                {copyState.copied && (
                                    <p className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1 font-medium">
                                        <i className="fas fa-check-circle"></i> Link copied to clipboard! Paste this URL as a new calendar subscription in your calendar app.
                                    </p>
                                )}

                                {copyState.failed && (
                                    <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1 font-medium">
                                        <i className="fas fa-exclamation-triangle"></i> Clipboard write was blocked by your browser. Please select and copy the URL manually above.
                                    </p>
                                )}

                                <div className="pt-3 border-t dark:border-gray-700">
                                    <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-xs text-red-800 dark:text-red-300 space-y-2">
                                        <div className="font-semibold flex items-center gap-1">
                                            <i className="fas fa-exclamation-circle"></i> Resetting invalidates active links
                                        </div>
                                        <p>
                                            If your feed URL was compromised, click below to generate a replacement link. Any existing calendar apps subscribed to the old link will stop syncing.
                                        </p>
                                        <button
                                            onClick={() => handleGenerateOrRotateCalendar(true)}
                                            disabled={isGeneratingToken}
                                            className="text-xs text-red-700 dark:text-red-300 font-bold underline hover:no-underline"
                                        >
                                            {isGeneratingToken ? 'Generating...' : 'Reset and generate new link'}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ) : hasCalendarToken ? (
                            <div className="space-y-4">
                                <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg text-xs text-blue-800 dark:text-blue-300 space-y-1">
                                    <div className="font-semibold flex items-center gap-1">
                                        <i className="fas fa-check-circle"></i> Calendar sync is active
                                    </div>
                                    <p>
                                        For security, secret tokens are only revealed upon generation and are not stored in plaintext. If you need a new link or need to reconnect a calendar app, you can generate a new link below.
                                    </p>
                                </div>

                                <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg text-xs text-amber-800 dark:text-amber-300">
                                    <span className="font-semibold">⚠️ Notice:</span> Generating a new link replaces your active token and will stop syncing on previously connected devices until updated.
                                </div>

                                <button
                                    onClick={() => handleGenerateOrRotateCalendar(true)}
                                    disabled={isGeneratingToken}
                                    className="btn btn-primary w-full flex items-center justify-center gap-2"
                                >
                                    <i className={`fas fa-sync-alt ${isGeneratingToken ? 'fa-spin' : ''}`}></i>
                                    {isGeneratingToken ? 'Generating...' : 'Generate New Calendar Link'}
                                </button>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                <p className="text-sm text-gray-600 dark:text-gray-300">
                                    You have not generated a calendar feed link yet. Generating a link allows external calendar applications (Google Calendar, Outlook, Apple Calendar) to subscribe to your live equipment reservations.
                                </p>
                                <button
                                    onClick={() => handleGenerateOrRotateCalendar(false)}
                                    disabled={isGeneratingToken}
                                    className="btn btn-primary w-full flex items-center justify-center gap-2"
                                >
                                    <i className={`fas fa-link ${isGeneratingToken ? 'fa-spin' : ''}`}></i>
                                    {isGeneratingToken ? 'Generating...' : 'Generate Calendar Feed URL'}
                                </button>
                            </div>
                        )}

                        <div className="flex justify-end pt-2">
                            <button
                                onClick={() => setCalendarModalOpen(false)}
                                className="btn btn-ghost btn-sm"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Dashboard;
