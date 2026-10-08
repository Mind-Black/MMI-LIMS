import React, { useState, useEffect, useMemo, useCallback, useRef, Suspense, lazy } from 'react';
import Icon from './Icon';
import { supabase } from '../supabaseClient';
import logo from '../assets/logo.svg';
import {
    LAB_TIMEZONE,
    formatLocalDate,
    getMonday,
    addDays,
    isBookingPast,
    isBookingInProgress,
    getVilniusNow
} from '../utils/bookingUtils';
import ConfirmModal from './ConfirmModal';
import RatePricingModal from './RatePricingModal';
import ToolList from './ToolList';
import BookingList from './BookingList';
import UserBookingsCalendar from './UserBookingsCalendar';
import LoadingSpinner from './LoadingSpinner';
import { useToast } from '../context/useToast';
import { useTheme } from '../context/useTheme';
import { useDialogFocus } from '../hooks/useDialogFocus';

// Code split admin-heavy components (P4)
const UserManagement = lazy(() => import('./UserManagement'));
const BookingModal = lazy(() => import('./BookingModal'));
const InfrastructureManagement = lazy(() => import('./InfrastructureManagement'));
const AddInfrastructureModal = lazy(() => import('./AddInfrastructureModal'));
const ApplyTrainingModal = lazy(() => import('./ApplyTrainingModal'));
const BOOKING_FIELDS = 'id, tool_id, tool_name, user_id, user_name, project, date, time, end_time, starts_at, ends_at, created_at, status, confirmed_by, confirmed_at';
const LEGACY_BOOKING_FIELDS = 'id, tool_id, tool_name, user_id, user_name, project, date, time, end_time, starts_at, ends_at, created_at';
const PAGE_SIZE = 500;

async function fetchAllPages(makeQuery, fallbackQuery = null) {
    const rows = [];
    let useFallback = false;
    for (let offset = 0; ;) {
        const currentQuery = (useFallback && fallbackQuery) ? fallbackQuery : makeQuery;
        let { data, error } = await currentQuery().range(offset, offset + PAGE_SIZE - 1);
        if (error && fallbackQuery && !useFallback && (error.message?.includes('status') || error.message?.includes('does not exist') || error.message?.includes('column'))) {
            useFallback = true;
            const fallbackRes = await fallbackQuery().range(offset, offset + PAGE_SIZE - 1);
            data = fallbackRes.data ? fallbackRes.data.map(b => ({ ...b, status: 'confirmed' })) : null;
            error = fallbackRes.error;
        }
        if (error) throw error;
        if (!data?.length) return rows;
        if (useFallback) {
            data = data.map(b => (b.status ? b : { ...b, status: 'confirmed' }));
        }
        rows.push(...data);
        if (data.length < PAGE_SIZE) return rows;
        offset += data.length;
    }
}

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
    const [activeTab, setActiveTab] = useState(() => {
        const view = new URLSearchParams(window.location.search).get('view');
        return ['dashboard', 'tools', ...(profile?.access_level === 'admin' ? ['all_bookings', 'users', 'infrastructure'] : [])].includes(view) ? view : 'dashboard';
    });
    const [tools, setTools] = useState([]);
    const [bookings, setBookings] = useState([]);
    const [userBookings, setUserBookings] = useState([]);
    const [adminBookings, setAdminBookings] = useState([]);
    const [pendingRequests, setPendingRequests] = useState([]);
    const [pendingBookings, setPendingBookings] = useState([]);
    const [applyModalTool, setApplyModalTool] = useState(null);
    const [loadingAdminBookings, setLoadingAdminBookings] = useState(false);
    const [adminError, setAdminError] = useState('');
    const [hasCalendarToken, setHasCalendarToken] = useState(false);

    // Infrastructure Modal State (Admin)
    const [infraModalOpen, setInfraModalOpen] = useState(false);
    const [infraModalMode, setInfraModalMode] = useState('single'); // 'single' | 'bulk'

    const handleInfrastructureAdded = (newTools) => {
        const toAdd = Array.isArray(newTools) ? newTools : [newTools];
        setTools(prev => {
            const existingIds = new Set(prev.map(t => t.id));
            const filtered = toAdd.filter(t => !existingIds.has(t.id));
            return [...prev, ...filtered].sort((a, b) => a.id - b.id);
        });
    };

    // Calendar sync modal state (R12)
    const [calendarModalOpen, setCalendarModalOpen] = useState(false);
    const calendarDialogRef = useDialogFocus(calendarModalOpen, () => setCalendarModalOpen(false));
    const [calendarUrl, setCalendarUrl] = useState('');
    const [isGeneratingToken, setIsGeneratingToken] = useState(false);
    const [copyState, setCopyState] = useState({ copied: false, failed: false });

    const [selectedTool, setSelectedTool] = useState(null);
    const [initialDate, setInitialDate] = useState(null);
    const [targetBooking, setTargetBooking] = useState(null);

    const [loading, setLoading] = useState(true);
    const [refreshError, setRefreshError] = useState('');
    const [lastUpdated, setLastUpdated] = useState(null);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
        try {
            return localStorage.getItem('mmi_sidebar_collapsed') === 'true';
        } catch {
            return false;
        }
    });

    const toggleSidebarCollapse = () => {
        setIsSidebarCollapsed(prev => {
            const next = !prev;
            try {
                localStorage.setItem('mmi_sidebar_collapsed', String(next));
            } catch {
                // Ignore storage errors
            }
            return next;
        });
    };

    const [confirmModalOpen, setConfirmModalOpen] = useState(false);
    const [bookingIdToCancel, setBookingIdToCancel] = useState(null);
    const [sendCancellationMessage, setSendCancellationMessage] = useState(false);
    const [isCancelling, setIsCancelling] = useState(false);
    const [isPricingModalOpen, setIsPricingModalOpen] = useState(false);

    // Filters for "All Bookings" (Admin)
    const [filterStartDate, setFilterStartDate] = useState(() => new URLSearchParams(window.location.search).get('from') || '');
    const [filterEndDate, setFilterEndDate] = useState(() => new URLSearchParams(window.location.search).get('to') || '');
    const [filterUserName, setFilterUserName] = useState(() => new URLSearchParams(window.location.search).get('user') || '');
    const [filterToolId, setFilterToolId] = useState(() => new URLSearchParams(window.location.search).get('tool') || '');
    const [debouncedUserName, setDebouncedUserName] = useState(filterUserName);
    const [adminPage, setAdminPage] = useState(0);
    const [adminTotal, setAdminTotal] = useState(0);
    const [historyStart, setHistoryStart] = useState(() => formatLocalDate(addDays(getVilniusNow().dateStr, -60)));

    // Week State (Monday as start of week without timezone distortion - Fixes R6)
    const [currentWeekStart, setCurrentWeekStart] = useState(() => getMonday(getVilniusNow().dateStr));

    const { showToast } = useToast();
    const { theme, toggleTheme } = useTheme();
    const querySeqRef = useRef(0);
    const adminQuerySeqRef = useRef(0);
    const catalogLoadedRef = useRef(false);
    const historyLoadedRef = useRef('');
    const activeTabRef = useRef(activeTab);
    activeTabRef.current = activeTab;
    const cancelCallbackRef = useRef(null);

    // Bounded Fetch Data (Fixes R5, R10): separate calendar window from user history
    const fetchData = useCallback(async (isBackground = false, refreshCatalog = false) => {
        const currentSeq = ++querySeqRef.current;

        try {
            // Calculate date window around visible week (-7 days to +14 days)
            const windowStart = addDays(currentWeekStart, -7);
            const windowEnd = addDays(currentWeekStart, 14);
            const startStr = formatLocalDate(windowStart);
            const endStr = formatLocalDate(windowEnd);

            // User history cutoff: last 60 days
            const needCatalog = !catalogLoadedRef.current || refreshCatalog;
            const needHistory = historyLoadedRef.current !== historyStart || refreshCatalog;

            const fetchToolsQuery = async () => {
                let res = await supabase.from('tools').select(`
                    id, name, category, rate_category, status, location, license_req, description, image_url,
                    primary_responsible_id, secondary_responsible_id,
                    primary_responsible:primary_responsible_id(id, first_name, last_name, email, phone, job_title),
                    secondary_responsible:secondary_responsible_id(id, first_name, last_name, email, phone, job_title)
                `).order('id');

                if (res.error) {
                    let fallback = await supabase.from('tools')
                        .select('id, name, category, rate_category, status, location, license_req, description, image_url, primary_responsible_id, secondary_responsible_id')
                        .order('id');
                    if (fallback.error) {
                        fallback = await supabase.from('tools')
                            .select('id, name, category, rate_category, status, location, license_req, description, image_url')
                            .order('id');
                    }
                    if (fallback.error) {
                        fallback = await supabase.from('tools')
                            .select('id, name, category, status, location, license_req, description')
                            .order('id');
                    }
                    if (!fallback.error) {
                        res = fallback;
                    }
                }
                return res;
            };

            const fetchPendingRequests = async () => {
                try {
                    const res = await supabase.from('training_requests')
                        .select('id, tool_id, tool_name, user_id, user_name, user_email, description, preferred_date, status, created_at')
                        .eq('status', 'pending')
                        .order('created_at', { ascending: false });
                    if (res?.error) return { data: [] };
                    return res?.data ? res : { data: [] };
                } catch {
                    return { data: [] };
                }
            };

            const fetchPendingBookings = async () => {
                try {
                    const res = await supabase.from('bookings')
                        .select(BOOKING_FIELDS)
                        .eq('status', 'pending_approval')
                        .order('date')
                        .order('time');
                    if (res?.error) return { data: [] };
                    return res?.data ? res : { data: [] };
                } catch {
                    return { data: [] };
                }
            };

            const [toolsRes, calendarRows, userRows, tokenRes, pendingReqsRes, pendingBookingsRes] = await Promise.all([
                needCatalog ? fetchToolsQuery() : null,
                fetchAllPages(
                    () => supabase.from('bookings').select(BOOKING_FIELDS)
                        .gte('date', startStr).lte('date', endStr)
                        .order('date').order('time').order('id'),
                    () => supabase.from('bookings').select(LEGACY_BOOKING_FIELDS)
                        .gte('date', startStr).lte('date', endStr)
                        .order('date').order('time').order('id')
                ),
                !needHistory ? null : fetchAllPages(
                    () => supabase.from('bookings').select(BOOKING_FIELDS)
                        .eq('user_id', user.id).gte('date', historyStart)
                        .order('date', { ascending: false }).order('time', { ascending: false }).order('id', { ascending: false }),
                    () => supabase.from('bookings').select(LEGACY_BOOKING_FIELDS)
                        .eq('user_id', user.id).gte('date', historyStart)
                        .order('date', { ascending: false }).order('time', { ascending: false }).order('id', { ascending: false })
                ),
                needCatalog ? supabase.rpc('has_calendar_token') : null,
                fetchPendingRequests(),
                fetchPendingBookings()
            ]);

            // If a newer query resolved already, discard this response
            if (currentSeq !== querySeqRef.current) return;

            if (toolsRes?.error) throw toolsRes.error;

            if (toolsRes?.data) {
                setTools(toolsRes.data);
                catalogLoadedRef.current = true;
            }
            setBookings(calendarRows);
            if (userRows) {
                setUserBookings(userRows);
                historyLoadedRef.current = historyStart;
            }
            if (tokenRes && !tokenRes.error && tokenRes.data !== undefined) {
                setHasCalendarToken(Boolean(tokenRes.data));
            }
            if (pendingReqsRes?.data) {
                setPendingRequests(pendingReqsRes.data);
            }
            if (pendingBookingsRes?.data) {
                setPendingBookings(pendingBookingsRes.data);
            }
            setRefreshError('');
            setLastUpdated(new Date());

        } catch (error) {
            if (currentSeq !== querySeqRef.current) return;
            console.error('Error fetching dashboard data:', error);
            setRefreshError(error.message || 'Could not refresh bookings.');
            if (!isBackground) {
                showToast('Error loading bookings: ' + error.message, 'error');
            }
        } finally {
            // Always clear loading if this was the latest sequence (Fixes R10)
            if (currentSeq === querySeqRef.current) {
                setLoading(false);
            }
        }
    }, [currentWeekStart, user.id, historyStart, showToast]);

    // Initial fetch and hidden-tab aware polling (P1)
    useEffect(() => {
        fetchData();

        const handleVisibilityChange = () => {
            if (!document.hidden) {
                fetchData(true, true);
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);

        const intervalId = setInterval(() => {
            if (!document.hidden && activeTabRef.current === 'dashboard') {
                fetchData(true);
            }
        }, 60000);

        return () => {
            clearInterval(intervalId);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [fetchData]);

    useEffect(() => {
        const timer = setTimeout(() => setDebouncedUserName(filterUserName), 300);
        return () => clearTimeout(timer);
    }, [filterUserName]);

    useEffect(() => {
        const syncFromUrl = () => {
            const params = new URLSearchParams(window.location.search);
            const view = params.get('view');
            setActiveTab(['dashboard', 'tools', ...(profile?.access_level === 'admin' ? ['all_bookings', 'users'] : [])].includes(view) ? view : 'dashboard');
            setFilterStartDate(params.get('from') || '');
            setFilterEndDate(params.get('to') || '');
            setFilterUserName(params.get('user') || '');
            setFilterToolId(params.get('tool') || '');
        };
        window.addEventListener('popstate', syncFromUrl);
        return () => window.removeEventListener('popstate', syncFromUrl);
    }, [profile?.access_level]);

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        for (const [key, value] of Object.entries({ view: activeTab, from: filterStartDate, to: filterEndDate, user: filterUserName, tool: filterToolId })) {
            if (value) params.set(key, value);
            else params.delete(key);
        }
        window.history.replaceState(null, '', `${window.location.pathname}?${params}${window.location.hash}`);
    }, [activeTab, filterStartDate, filterEndDate, filterUserName, filterToolId]);

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
    const nextBooking = useMemo(() => [...myBookings]
        .filter(b => !isBookingPast(b))
        .sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`))[0], [myBookings]);

    // Total booked lab hours for current user in visible week
    const thisWeekUserHours = useMemo(() => {
        const mondayStr = formatLocalDate(currentWeekStart);
        const sundayStr = formatLocalDate(addDays(currentWeekStart, 6));
        return myBookings
            .filter(b => b.date >= mondayStr && b.date <= sundayStr && b.status !== 'rejected')
            .reduce((acc, b) => {
                const start = (b.time || '00:00').split(':').map(Number);
                const end = (b.end_time || '00:30').split(':').map(Number);
                const durationMins = (end[0] * 60 + end[1]) - (start[0] * 60 + start[1]);
                return acc + (durationMins > 0 ? durationMins / 60 : 0.5);
            }, 0);
    }, [myBookings, currentWeekStart]);

    const totalPendingActions = useMemo(() => {
        return pendingRequests.length + pendingBookings.length;
    }, [pendingRequests, pendingBookings]);
    const clearAdminFilters = () => {
        setFilterStartDate(''); setFilterEndDate(''); setFilterUserName(''); setFilterToolId('');
    };
    const setDateShortcut = (daysBack) => {
        const today = getVilniusNow().dateStr;
        setFilterStartDate(formatLocalDate(addDays(today, -daysBack)));
        setFilterEndDate(today);
    };

    // Server-side filtered query for Admin "All Bookings" tab (Fixes R5)
    const fetchAdminBookings = useCallback(async () => {
        if (profile?.access_level !== 'admin') return;
        const request = ++adminQuerySeqRef.current;
        setLoadingAdminBookings(true);
        try {
            const rows = [];
            let total = 0;
            let offset = adminPage * 200;
            let useFallback = false;
            while (rows.length < 200) {
                let query = supabase.from('bookings').select(useFallback ? LEGACY_BOOKING_FIELDS : BOOKING_FIELDS, { count: 'exact' })
                    .order('date', { ascending: false }).order('time', { ascending: false }).order('id', { ascending: false });
                if (filterStartDate) query = query.gte('date', filterStartDate);
                if (filterEndDate) query = query.lte('date', filterEndDate);
                if (debouncedUserName.trim()) query = query.ilike('user_name', `%${debouncedUserName.trim()}%`);
                if (filterToolId) query = query.eq('tool_id', filterToolId);
                let { data, error, count } = await query.range(offset, offset + 199 - rows.length);
                if (error && !useFallback && (error.message?.includes('status') || error.message?.includes('does not exist') || error.message?.includes('column'))) {
                    useFallback = true;
                    let legacyQuery = supabase.from('bookings').select(LEGACY_BOOKING_FIELDS, { count: 'exact' })
                        .order('date', { ascending: false }).order('time', { ascending: false }).order('id', { ascending: false });
                    if (filterStartDate) legacyQuery = legacyQuery.gte('date', filterStartDate);
                    if (filterEndDate) legacyQuery = legacyQuery.lte('date', filterEndDate);
                    if (debouncedUserName.trim()) legacyQuery = legacyQuery.ilike('user_name', `%${debouncedUserName.trim()}%`);
                    if (filterToolId) legacyQuery = legacyQuery.eq('tool_id', filterToolId);
                    const legacyRes = await legacyQuery.range(offset, offset + 199 - rows.length);
                    data = legacyRes.data ? legacyRes.data.map(b => ({ ...b, status: 'confirmed' })) : null;
                    error = legacyRes.error;
                    count = legacyRes.count;
                }
                if (error) throw error;
                total = count || 0;
                if (!data?.length) break;
                const formattedData = useFallback ? data.map(b => (b.status ? b : { ...b, status: 'confirmed' })) : data;
                rows.push(...formattedData);
                if (data.length < (200 - (rows.length - data.length))) {
                    offset += data.length;
                    break;
                }
                offset += data.length;
            }
            if (request !== adminQuerySeqRef.current) return;
            setAdminBookings(rows);
            setAdminTotal(total);
            setAdminError('');
        } catch (err) {
            if (request !== adminQuerySeqRef.current) return;
            console.error('Error fetching admin bookings:', err);
            setAdminError(err.message || 'Could not load bookings.');
            showToast('Error loading all bookings: ' + err.message, 'error');
        } finally {
            if (request === adminQuerySeqRef.current) setLoadingAdminBookings(false);
        }
    }, [profile?.access_level, filterStartDate, filterEndDate, debouncedUserName, filterToolId, adminPage, showToast]);

    useEffect(() => {
        if (activeTab === 'all_bookings' && profile?.access_level === 'admin') {
            fetchAdminBookings();
        }
    }, [activeTab, profile?.access_level, fetchAdminBookings]);

    useEffect(() => { setAdminPage(0); }, [filterStartDate, filterEndDate, debouncedUserName, filterToolId]);

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
            let { data, error } = await supabase
                .from('bookings')
                .insert(newBookings)
                .select();

            if (error && (error.message?.includes('status') || error.message?.includes('does not exist') || error.message?.includes('column'))) {
                const sanitized = newBookings.map(b => {
                    const copy = { ...b };
                    delete copy.status;
                    delete copy.confirmed_by;
                    delete copy.confirmed_at;
                    return copy;
                });
                const retry = await supabase
                    .from('bookings')
                    .insert(sanitized)
                    .select();
                data = retry.data ? retry.data.map(b => ({ ...b, status: 'confirmed' })) : null;
                error = retry.error;
            }

            if (error) throw error;
            if (!data || data.length === 0) {
                throw new Error('No booking record was created');
            }

            setBookings(prev => [...prev, ...data]);
            setUserBookings(prev => [...prev, ...data]);
            const pending = data.filter(b => b.status === 'pending_approval');
            if (pending.length > 0) {
                setPendingBookings(prev => [...prev, ...pending]);
            }
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

    const initiateCancel = (ids, onSuccess) => {
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
        cancelCallbackRef.current = typeof onSuccess === 'function' ? onSuccess : null;
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
            setPendingBookings(prev => prev.filter(b => !cancelledIds.includes(b.id)));
            showToast("Booking has been cancelled.", 'success');

            if (cancelCallbackRef.current) {
                cancelCallbackRef.current(cancelledIds);
                cancelCallbackRef.current = null;
            }

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
            cancelCallbackRef.current = null;
        }
    };

    // Confirm a Level II pending reservation (Tool Responsible or Admin)
    const handleConfirmBookingApproval = async (booking) => {
        try {
            const { error } = await supabase.rpc('confirm_booking', {
                p_booking_id: booking.id
            });
            if (error) throw error;
            showToast(`Confirmed reservation for ${booking.user_name} on ${booking.tool_name}.`, 'success');
            const updater = prev => prev.map(b => b.id === booking.id ? { ...b, status: 'confirmed' } : b);
            setBookings(updater);
            setUserBookings(updater);
            setAdminBookings(updater);
            setPendingBookings(prev => prev.filter(b => b.id !== booking.id));
        } catch (err) {
            console.error('Error confirming booking approval:', err);
            showToast('Failed to confirm booking: ' + (err.message || 'Unknown error'), 'error');
        }
    };

    // Reject a Level II pending reservation (Tool Responsible or Admin)
    const handleRejectBookingApproval = async (booking, reason = null) => {
        try {
            const { error } = await supabase.rpc('reject_booking', {
                p_booking_id: booking.id,
                p_reason: reason
            });
            if (error) throw error;
            showToast(`Reservation rejected. Time slot released.`, 'info');
            const remover = prev => prev.filter(b => b.id !== booking.id);
            setBookings(remover);
            setUserBookings(remover);
            setAdminBookings(remover);
            setPendingBookings(remover);
        } catch (err) {
            console.error('Error rejecting booking approval:', err);
            showToast('Failed to reject booking: ' + (err.message || 'Unknown error'), 'error');
        }
    };

    // Approve training request -> Assigns Level I (Training)
    const handleApproveTrainingRequest = async (request) => {
        try {
            const { error } = await supabase.rpc('approve_training_request', {
                p_request_id: request.id
            });
            if (error) throw error;
            showToast(`Approved training application for ${request.user_name} on ${request.tool_name} (Level I assigned).`, 'success');
            setPendingRequests(prev => prev.filter(r => r.id !== request.id));
            if (request.user_id === user.id && onProfileRefresh) {
                onProfileRefresh();
            }
        } catch (err) {
            console.error('Error approving training request:', err);
            showToast('Failed to approve request: ' + (err.message || 'Unknown error'), 'error');
        }
    };

    // Reject training request
    const handleRejectTrainingRequest = async (request, notes = null) => {
        try {
            const { error } = await supabase.rpc('reject_training_request', {
                p_request_id: request.id,
                p_notes: notes
            });
            if (error) throw error;
            showToast(`Rejected training application for ${request.user_name}.`, 'info');
            setPendingRequests(prev => prev.filter(r => r.id !== request.id));
        } catch (err) {
            console.error('Error rejecting training request:', err);
            showToast('Failed to reject request: ' + (err.message || 'Unknown error'), 'error');
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

    if (loading && !lastUpdated) {
        return (
            <div className="flex items-center justify-center h-screen bg-gray-100 dark:bg-gray-900 transition-colors">
                <LoadingSpinner />
            </div>
        );
    }

    const handleNavigation = (tabName) => {
        setActiveTab(tabName);
        setIsSidebarOpen(false);
        const params = new URLSearchParams(window.location.search);
        params.set('view', tabName);
        window.history.pushState(null, '', `${window.location.pathname}?${params}${window.location.hash}`);
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
            <aside className={`fixed inset-y-0 left-0 z-50 bg-white dark:bg-gray-800 shadow-lg flex flex-col transition-all duration-300 ease-in-out lg:static lg:inset-auto ${isSidebarOpen ? 'translate-x-0 w-64' : '-translate-x-full lg:translate-x-0'} ${isSidebarCollapsed ? 'lg:w-20' : 'lg:w-64'}`}>
                <div className="h-16 flex items-center justify-center border-b border-blue-900 lims-header transition-colors px-3">
                    <div className="font-bold text-xl tracking-wider flex items-center justify-center overflow-hidden">
                        <img src={logo} alt="Logo" className="h-8 brightness-0 invert shrink-0" />
                        {!isSidebarCollapsed && <span className="ml-2 truncate">MMI-LIMS</span>}
                    </div>
                </div>

                <div className={`p-4 border-b dark:border-gray-700 ${isSidebarCollapsed ? 'text-center px-2' : ''}`}>
                    {!isSidebarCollapsed ? (
                        <>
                            <div className="text-xs text-gray-500 dark:text-gray-400">Logged in as</div>
                            <div className="font-bold text-gray-800 dark:text-gray-200 truncate">
                                {profile ? `${profile.first_name || ''} ${profile.last_name || ''}`.trim() : user.email}
                            </div>
                            <div className="text-xs text-blue-600 dark:text-blue-400 font-semibold uppercase mt-1 flex items-center gap-1.5 flex-wrap">
                                <span>{profile?.job_title || 'Researcher'}</span>
                                {profile?.access_level === 'admin' && <span className="bg-red-600 text-white px-1.5 py-0.5 rounded text-[10px]">ADMIN</span>}
                            </div>
                            <div className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">
                                Timezone: <span className="font-medium text-gray-600 dark:text-gray-300">{LAB_TIMEZONE}</span>
                            </div>
                        </>
                    ) : (
                        <div className="flex flex-col items-center" title={`${profile ? `${profile.first_name || ''} ${profile.last_name || ''}` : user.email} (${profile?.job_title || 'Researcher'})`}>
                            <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 flex items-center justify-center font-bold text-sm shadow-xs">
                                {profile?.first_name ? profile.first_name[0] : (user.email ? user.email[0].toUpperCase() : 'U')}
                            </div>
                            {profile?.access_level === 'admin' && (
                                <span className="mt-1 bg-red-600 text-white px-1 rounded text-[9px] font-bold">ADM</span>
                            )}
                        </div>
                    )}
                </div>

                {/* Navigation Links */}
                <nav className="flex-1 p-3 space-y-1.5 overflow-y-auto custom-scroll">
                    <button
                        onClick={() => handleNavigation('dashboard')}
                        title="My Dashboard"
                        className={`w-full flex items-center ${isSidebarCollapsed ? 'justify-center px-2' : 'gap-3 px-4'} py-3 rounded-lg text-sm font-medium transition ${activeTab === 'dashboard' ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-bold shadow-xs' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/60'}`}
                    >
                        <Icon className="fas fa-calendar-alt text-base text-center shrink-0" />
                        {!isSidebarCollapsed && <span>My Dashboard</span>}
                    </button>
                    <button
                        onClick={() => handleNavigation('tools')}
                        title="Equipment List"
                        className={`w-full flex items-center ${isSidebarCollapsed ? 'justify-center px-2' : 'gap-3 px-4'} py-3 rounded-lg text-sm font-medium transition ${activeTab === 'tools' ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-bold shadow-xs' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/60'}`}
                    >
                        <Icon className="fas fa-microscope text-base text-center shrink-0" />
                        {!isSidebarCollapsed && <span>Equipment List</span>}
                    </button>
                    <button
                        onClick={() => setIsPricingModalOpen(true)}
                        title="Equipment Rates & Access Modes"
                        className={`w-full flex items-center ${isSidebarCollapsed ? 'justify-center px-2' : 'gap-3 px-4'} py-3 rounded-lg text-sm font-medium transition text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/60 cursor-pointer`}
                    >
                        <Icon className="fas fa-tags text-base text-center shrink-0 text-emerald-600 dark:text-emerald-400" />
                        {!isSidebarCollapsed && <span>Rates & Pricing</span>}
                    </button>

                    {profile?.access_level === 'admin' && (
                        <>
                            <div className="pt-3 pb-1">
                                {!isSidebarCollapsed ? (
                                    <div className="px-4 text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                                        Administration
                                    </div>
                                ) : (
                                    <div className="border-t dark:border-gray-700 my-2"></div>
                                )}
                            </div>
                            <button
                                onClick={() => handleNavigation('all_bookings')}
                                title="All Bookings"
                                className={`w-full flex items-center ${isSidebarCollapsed ? 'justify-center px-2' : 'gap-3 px-4'} py-3 rounded-lg text-sm font-medium transition ${activeTab === 'all_bookings' ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-bold shadow-xs' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/60'}`}
                            >
                                <Icon className="fas fa-list-alt text-base text-center shrink-0" />
                                {!isSidebarCollapsed && <span>All Bookings</span>}
                            </button>
                            <button
                                onClick={() => handleNavigation('users')}
                                title="User Management"
                                className={`w-full flex items-center ${isSidebarCollapsed ? 'justify-center px-2' : 'gap-3 px-4'} py-3 rounded-lg text-sm font-medium transition ${activeTab === 'users' ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-bold shadow-xs' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/60'}`}
                            >
                                <Icon className="fas fa-users-cog text-base text-center shrink-0" />
                                {!isSidebarCollapsed && <span>User Management</span>}
                            </button>
                            <button
                                onClick={() => handleNavigation('infrastructure')}
                                title="Infrastructure"
                                className={`w-full flex items-center ${isSidebarCollapsed ? 'justify-center px-2' : 'gap-3 px-4'} py-3 rounded-lg text-sm font-medium transition ${activeTab === 'infrastructure' ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-bold shadow-xs' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/60'}`}
                            >
                                <Icon className="fas fa-server text-base text-center shrink-0" />
                                {!isSidebarCollapsed && <span>Infrastructure</span>}
                            </button>
                        </>
                    )}
                </nav>

                <div className="p-3 border-t dark:border-gray-700 space-y-2">
                    {/* Desktop Sidebar Collapse Toggle */}
                    <button
                        onClick={toggleSidebarCollapse}
                        title={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                        className={`hidden lg:flex w-full items-center ${isSidebarCollapsed ? 'justify-center px-2' : 'justify-between px-3'} py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors`}
                    >
                        {!isSidebarCollapsed && <span>Collapse Sidebar</span>}
                        <Icon className={`fas ${isSidebarCollapsed ? 'fa-chevron-right' : 'fa-chevron-left'} text-sm`} />
                    </button>

                    <button
                        onClick={toggleTheme}
                        aria-pressed={theme === 'dark'}
                        aria-label={`Dark theme ${theme === 'dark' ? 'on' : 'off'}. Switch theme`}
                        title={theme === 'dark' ? "Switch to light theme" : "Switch to dark theme"}
                        className={`w-full flex items-center ${isSidebarCollapsed ? 'justify-center px-2' : 'justify-between px-3'} py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg transition`}
                    >
                        {!isSidebarCollapsed && <span>Dark Theme</span>}
                        <Icon className={`fas ${theme === 'dark' ? 'fa-moon text-blue-400' : 'fa-sun text-yellow-500'}`} />
                    </button>
                    <button
                        onClick={onLogout}
                        title="Sign Out"
                        className={`w-full flex items-center ${isSidebarCollapsed ? 'justify-center px-2' : 'gap-3 px-3'} py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition`}
                    >
                        <Icon className="fas fa-sign-out-alt text-base text-center shrink-0" />
                        {!isSidebarCollapsed && <span>Sign Out</span>}
                    </button>
                </div>
            </aside>

            {/* Main Content */}
            <div className="flex-1 flex flex-col overflow-hidden">
                {/* Mobile Header */}
                <header className="h-16 bg-white dark:bg-gray-800 border-b dark:border-gray-700 flex items-center justify-between px-4 lg:hidden sticky top-0 z-30 shadow-xs">
                    <div className="flex items-center gap-2.5">
                        <button
                            onClick={() => setIsSidebarOpen(true)}
                            aria-label="Open navigation menu"
                            className="p-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg min-w-[44px] min-h-[44px] flex items-center justify-center cursor-pointer"
                        >
                            <Icon className="fas fa-bars text-xl" />
                        </button>
                        <div className="flex items-center gap-2 font-bold text-base text-gray-800 dark:text-gray-100">
                            <img src={logo} alt="Logo" className="h-6 w-auto" />
                            <span>MMI-LIMS</span>
                        </div>
                    </div>
                    <div className="flex items-center gap-1">
                        <button
                            onClick={handleOpenCalendarModal}
                            className="p-2 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg min-w-[44px] min-h-[44px] flex items-center justify-center cursor-pointer"
                            title="Subscribe to calendar feed (ICS)"
                            aria-label="Subscribe to calendar feed"
                        >
                            <Icon className="fas fa-calendar-alt text-base" />
                        </button>
                        <button
                            onClick={toggleTheme}
                            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
                            className="p-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg min-w-[44px] min-h-[44px] flex items-center justify-center cursor-pointer"
                        >
                            <Icon className={`fas ${theme === 'dark' ? 'fa-moon text-blue-400' : 'fa-sun text-yellow-500'} text-base`} />
                        </button>
                    </div>
                </header>

                <main className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8 pb-24 lg:pb-8">
                    {refreshError && <div role="alert" className="mb-4 p-3 rounded bg-amber-50 dark:bg-amber-900/30 text-amber-900 dark:text-amber-200 text-sm">
                        Booking data may be out of date: {refreshError} <button onClick={() => fetchData(true, true)} className="underline ml-2">Retry</button>
                    </div>}
                    {/* TAB: DASHBOARD */}
                    {activeTab === 'dashboard' && (
                        <div className="space-y-6">
                            {/* Top Stats & Quick Status Hub */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                                {/* Next Booking Card */}
                                <div className="card p-4 flex flex-col justify-between border-l-4 border-l-blue-600">
                                    <div className="flex justify-between items-start">
                                        <span className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Next Reservation</span>
                                        <Icon className="fas fa-clock text-blue-600 dark:text-blue-400 text-sm" />
                                    </div>
                                    <div className="mt-2 min-w-0">
                                        {nextBooking ? (
                                            <>
                                                <div className="font-bold text-gray-900 dark:text-gray-100 truncate text-sm">
                                                    {nextBooking.tool_name}
                                                </div>
                                                <div className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
                                                    {nextBooking.date} · {nextBooking.time?.slice(0, 5)}
                                                </div>
                                                {nextBooking.status === 'pending_approval' && (
                                                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/40 px-2 py-0.5 rounded-full mt-1.5 border border-amber-300 dark:border-amber-700">
                                                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>
                                                        Pending Confirmation
                                                    </span>
                                                )}
                                            </>
                                        ) : (
                                            <div className="text-xs text-gray-500 dark:text-gray-400 italic">No upcoming reservations</div>
                                        )}
                                    </div>
                                </div>

                                {/* Active Hours This Week */}
                                <div className="card p-4 flex flex-col justify-between border-l-4 border-l-indigo-600">
                                    <div className="flex justify-between items-start">
                                        <span className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">This Week's Bookings</span>
                                        <Icon className="fas fa-business-time text-indigo-600 dark:text-indigo-400 text-sm" />
                                    </div>
                                    <div className="mt-2">
                                        <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                                            {thisWeekUserHours.toFixed(1)} <span className="text-xs font-normal text-gray-500">hours</span>
                                        </div>
                                        <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                                            {myBookings.filter(b => !isBookingPast(b)).length} upcoming session(s)
                                        </div>
                                    </div>
                                </div>

                                {/* Lab Status & Actions */}
                                <div className="card p-4 flex flex-col justify-between border-l-4 border-l-amber-500">
                                    <div className="flex justify-between items-start">
                                        <span className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                                            {totalPendingActions > 0 ? 'Pending Actions' : 'Lab Availability'}
                                        </span>
                                        <Icon className={`fas ${totalPendingActions > 0 ? 'fa-bell text-amber-500 animate-bounce' : 'fa-check-circle text-green-500'} text-sm`} />
                                    </div>
                                    <div className="mt-2">
                                        {totalPendingActions > 0 ? (
                                            <>
                                                <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">
                                                    {totalPendingActions}
                                                </div>
                                                <div className="text-[11px] text-gray-600 dark:text-gray-300">
                                                    Item(s) awaiting confirmation
                                                </div>
                                            </>
                                        ) : (
                                            <>
                                                <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                                                    {tools.filter(t => t.status === 'up').length} <span className="text-xs font-normal text-gray-500">/ {tools.length}</span>
                                                </div>
                                                <div className="text-[11px] text-green-600 dark:text-green-400 font-medium">
                                                    Instruments operational
                                                </div>
                                            </>
                                        )}
                                    </div>
                                </div>

                                {/* Quick Reserve Button Card */}
                                <div className="card p-4 flex flex-col justify-between bg-gradient-to-br from-blue-600 to-blue-700 text-white shadow-md">
                                    <div>
                                        <div className="text-xs font-bold uppercase tracking-wider text-blue-100">Reserve Instrument</div>
                                        <div className="text-xs text-blue-100 mt-1">Book equipment in the cleanroom and analytical lab.</div>
                                    </div>
                                    <button
                                        onClick={() => handleNavigation('tools')}
                                        className="mt-3 w-full bg-white text-blue-700 hover:bg-blue-50 font-bold py-2 px-3 rounded-lg text-xs transition-colors shadow-xs flex items-center justify-center gap-1.5 cursor-pointer"
                                    >
                                        <Icon className="fas fa-plus text-xs" />
                                        <span>Browse & Book</span>
                                    </button>
                                </div>
                            </div>

                            {/* Main Desktop Grid: 8 Cols Calendar + 4 Cols Side Panel */}
                            <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
                                {/* Center Column: My Bookings Calendar (8 cols on desktop) */}
                                <div className="xl:col-span-8 flex flex-col space-y-4">
                                    <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-2 bg-white dark:bg-gray-800 p-4 rounded-lg shadow-xs border dark:border-gray-700">
                                        <div>
                                            <h3 className="font-bold text-base text-gray-800 dark:text-gray-100 flex items-center gap-2">
                                                <Icon className="fas fa-calendar-alt text-blue-600 dark:text-blue-400" />
                                                <span>Weekly Reservation Calendar</span>
                                            </h3>
                                            <div className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-2 mt-0.5">
                                                <span>Timezone: <strong>{LAB_TIMEZONE}</strong></span>
                                                {lastUpdated && <span>· Updated {lastUpdated.toLocaleTimeString()}</span>}
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <button
                                                onClick={handleOpenCalendarModal}
                                                className="btn btn-secondary btn-sm flex items-center gap-1.5 text-xs"
                                                title="Subscribe to calendar feed (ICS)"
                                            >
                                                <Icon className="fas fa-calendar-plus text-blue-600 dark:text-blue-400" />
                                                <span>Sync External Calendar</span>
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

                                {/* Right Side Panel: Quick Book, Upcoming & Past Bookings (4 cols on desktop) */}
                                <div className="xl:col-span-4 flex flex-col space-y-6">
                                    {/* Quick Book */}
                                    <div className="flex flex-col">
                                        <div className="flex justify-between items-center mb-3">
                                            <h3 className="font-bold text-sm text-gray-800 dark:text-gray-200 flex items-center gap-1.5">
                                                <Icon className="fas fa-bolt text-amber-500" />
                                                <span>Quick Book (Recent Tools)</span>
                                            </h3>
                                        </div>
                                        <div className="card p-0">
                                            <div className="overflow-y-auto p-3 custom-scroll max-h-[300px]">
                                                {recentTools.length > 0 ? (
                                                    <div className="grid grid-cols-1 gap-2.5">
                                                        {recentTools.map(tool => (
                                                            <button
                                                                type="button"
                                                                key={tool.id}
                                                                className="bg-gray-50 dark:bg-gray-900/60 p-3 rounded-lg border dark:border-gray-700 hover:shadow-xs hover:border-blue-300 dark:hover:border-blue-600 transition cursor-pointer flex justify-between items-center group text-left"
                                                                onClick={() => setSelectedTool(tool)}
                                                            >
                                                                <div className="min-w-0 pr-2">
                                                                    <div className="font-bold text-xs text-gray-800 dark:text-gray-200 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors truncate">
                                                                        {tool.name}
                                                                    </div>
                                                                    <div className="text-[11px] text-gray-500 dark:text-gray-400 truncate">{tool.category}</div>
                                                                </div>
                                                                <div className="h-7 w-7 shrink-0 bg-white dark:bg-gray-800 rounded-full flex items-center justify-center text-blue-600 dark:text-blue-400 group-hover:bg-blue-600 group-hover:text-white transition-colors shadow-xs">
                                                                    <Icon className="fas fa-plus text-xs" />
                                                                </div>
                                                            </button>
                                                        ))}
                                                    </div>
                                                ) : (
                                                    <div className="text-gray-500 dark:text-gray-400 py-4 text-xs text-center">
                                                        No recent equipment reservations.<br />
                                                        <button onClick={() => handleNavigation('tools')} className="text-blue-600 dark:text-blue-400 underline font-semibold mt-1">Browse full equipment catalog</button>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Upcoming Bookings */}
                                    <div className="flex flex-col">
                                        <div className="flex justify-between items-center mb-3">
                                            <h3 className="font-bold text-sm text-gray-800 dark:text-gray-200 flex items-center gap-1.5">
                                                <Icon className="fas fa-calendar-check text-green-600 dark:text-green-400" />
                                                <span>Upcoming Bookings</span>
                                            </h3>
                                        </div>
                                        <div className="card p-0 max-h-[350px] flex flex-col">
                                            <div className="overflow-y-auto p-3 custom-scroll">
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

                                    {/* Past Bookings */}
                                    <div className="flex flex-col">
                                        <div className="flex justify-between items-center mb-2">
                                            <h3 className="font-bold text-sm text-gray-600 dark:text-gray-400 flex items-center gap-1.5">
                                                <Icon className="fas fa-history text-gray-400" />
                                                <span>Past Reservations</span>
                                            </h3>
                                        </div>
                                        <div className="card p-0 bg-gray-50/70 dark:bg-gray-900/40 max-h-[320px] flex flex-col">
                                            <div className="overflow-y-auto p-3 custom-scroll">
                                                <BookingList
                                                    bookings={myBookings.filter(b => isBookingPast(b))}
                                                    allBookings={allCalendarBookings}
                                                    onCancel={initiateCancel}
                                                    onUpdate={handleUpdateBooking}
                                                    onEdit={handleBookingClick}
                                                    readOnly={true}
                                                    showSort={true}
                                                />
                                                <div className="text-center pt-2">
                                                    <button onClick={() => setHistoryStart(formatLocalDate(addDays(historyStart, -90)))} className="text-xs text-blue-600 dark:text-blue-400 hover:underline">
                                                        Load older history
                                                    </button>
                                                </div>
                                            </div>
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
                            onOpenAddModal={(mode = 'single') => {
                                setInfraModalMode(mode);
                                setInfraModalOpen(true);
                            }}
                            onApplyTraining={setApplyModalTool}
                            pendingRequests={pendingRequests}
                            pendingBookings={pendingBookings}
                            onApproveRequest={handleApproveTrainingRequest}
                            onRejectRequest={handleRejectTrainingRequest}
                            onConfirmBooking={handleConfirmBookingApproval}
                            onRejectBooking={handleRejectBookingApproval}
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
                                    <Icon className={`fas fa-sync-alt ${loadingAdminBookings ? 'fa-spin' : ''}`} /> Refresh
                                </button>
                            </div>

                            <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-sm border dark:border-gray-700 mb-4 grid grid-cols-1 md:grid-cols-4 gap-4 transition-colors">
                                <div className="md:col-span-4 flex gap-3 text-sm">
                                    <button onClick={() => setDateShortcut(0)} className="text-blue-700 dark:text-blue-300 underline">Today</button>
                                    <button onClick={() => setDateShortcut(6)} className="text-blue-700 dark:text-blue-300 underline">Past week</button>
                                    <button onClick={clearAdminFilters} className="text-blue-700 dark:text-blue-300 underline">Clear filters</button>
                                </div>
                                <div>
                                    <label htmlFor="filter-start-date" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Start Date</label>
                                    <input
                                        id="filter-start-date"
                                        type="date"
                                        className="w-full border border-gray-300 dark:border-gray-600 rounded p-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        value={filterStartDate}
                                        onChange={(e) => setFilterStartDate(e.target.value)}
                                    />
                                </div>
                                <div>
                                    <label htmlFor="filter-end-date" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">End Date</label>
                                    <input
                                        id="filter-end-date"
                                        type="date"
                                        className="w-full border border-gray-300 dark:border-gray-600 rounded p-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        value={filterEndDate}
                                        onChange={(e) => setFilterEndDate(e.target.value)}
                                    />
                                </div>
                                <div>
                                    <label htmlFor="filter-user" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">User Name</label>
                                    <input
                                        id="filter-user"
                                        type="text"
                                        className="w-full border border-gray-300 dark:border-gray-600 rounded p-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        placeholder="Filter by user..."
                                        value={filterUserName}
                                        onChange={(e) => setFilterUserName(e.target.value)}
                                    />
                                </div>
                                <div>
                                    <label htmlFor="filter-tool" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Tool</label>
                                    <select
                                        id="filter-tool"
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
                                {adminError && <p role="alert" className="mb-3 text-sm text-red-700 dark:text-red-300">Could not refresh this list: {adminError} <button onClick={fetchAdminBookings} className="underline">Retry</button></p>}
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
                                        isFiltered={Boolean(filterStartDate || filterEndDate || filterUserName || filterToolId)}
                                        onClearFilters={clearAdminFilters}
                                    />
                                )}
                                <div className="flex items-center justify-between gap-3 mt-4 text-sm text-gray-700 dark:text-gray-300">
                                    <span>{adminTotal ? `${adminPage * 200 + 1}–${Math.min((adminPage + 1) * 200, adminTotal)} of ${adminTotal}` : '0 bookings'}</span>
                                    <div className="flex gap-2">
                                        <button disabled={adminPage === 0 || loadingAdminBookings} onClick={() => setAdminPage(p => p - 1)} className="btn btn-secondary btn-sm">Previous</button>
                                        <button disabled={(adminPage + 1) * 200 >= adminTotal || loadingAdminBookings} onClick={() => setAdminPage(p => p + 1)} className="btn btn-secondary btn-sm">Next</button>
                                    </div>
                                </div>
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

                    {/* TAB: INFRASTRUCTURE (ADMIN ONLY - Lazy Loaded) */}
                    {activeTab === 'infrastructure' && profile?.access_level === 'admin' && (
                        <Suspense fallback={<div className="p-8 text-center"><LoadingSpinner /></div>}>
                            <InfrastructureManagement
                                tools={tools}
                                onStatusChange={handleStatusChange}
                                onToolsChange={setTools}
                                onOpenAddModal={(mode = 'single') => {
                                    setInfraModalMode(mode);
                                    setInfraModalOpen(true);
                                }}
                            />
                        </Suspense>
                    )}
                </main>
            </div>

            {infraModalOpen && profile?.access_level === 'admin' && (
                <Suspense fallback={null}>
                    <AddInfrastructureModal
                        isOpen={infraModalOpen}
                        onClose={() => setInfraModalOpen(false)}
                        onSuccess={handleInfrastructureAdded}
                        existingTools={tools}
                        defaultMode={infraModalMode}
                    />
                </Suspense>
            )}

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

            {applyModalTool && (
                <Suspense fallback={null}>
                    <ApplyTrainingModal
                        isOpen={Boolean(applyModalTool)}
                        onClose={() => setApplyModalTool(null)}
                        tool={applyModalTool}
                        user={user}
                        profile={profile}
                        onSuccess={(newReq) => {
                            if (newReq) {
                                setPendingRequests(prev => [newReq, ...prev]);
                            }
                        }}
                    />
                </Suspense>
            )}

            <ConfirmModal
                isOpen={confirmModalOpen}
                title="Cancel Booking"
                message="Are you sure you want to cancel this booking? This action cannot be undone."
                onConfirm={handleConfirmCancel}
                onCancel={() => { setConfirmModalOpen(false); setBookingIdToCancel(null); cancelCallbackRef.current = null; }}
                showCheckbox={true}
                checkboxLabel="Send cancellation message to licensed users"
                isCheckboxChecked={sendCancellationMessage}
                onCheckboxChange={setSendCancellationMessage}
                isLoading={isCancelling}
            />

            {/* Rate & Pricing Guide Modal */}
            <RatePricingModal
                isOpen={isPricingModalOpen}
                onClose={() => setIsPricingModalOpen(false)}
            />

            {/* Calendar Subscription Feed Modal (Fixes R12) */}
            {calendarModalOpen && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                    <div ref={calendarDialogRef} role="dialog" aria-modal="true" aria-labelledby="calendar-dialog-title" tabIndex={-1} className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-lg w-full p-6 space-y-4">
                        <div className="flex justify-between items-center">
                            <h3 id="calendar-dialog-title" className="text-lg font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                                <Icon className="fas fa-calendar-alt text-blue-600 dark:text-blue-400" />
                                Calendar Subscription (ICS Feed)
                            </h3>
                            <button
                                onClick={() => setCalendarModalOpen(false)}
                                aria-label="Close calendar subscription dialog"
                                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                            >
                                <Icon className="fas fa-times text-lg" />
                            </button>
                        </div>

                        <p className="text-sm text-gray-600 dark:text-gray-300">
                            Subscribe to your personal reservations in Google Calendar, Apple Calendar, or Outlook.
                        </p>
                        <div className="text-xs text-gray-600 dark:text-gray-300 space-y-1">
                            <p><strong>Google Calendar:</strong> Other calendars → From URL.</p>
                            <p><strong>Apple Calendar:</strong> File → New Calendar Subscription.</p>
                            <p><strong>Outlook:</strong> Add calendar → Subscribe from web.</p>
                            <p>Paste the private URL below. Calendar apps control their own refresh schedules, so changes may take time to appear.</p>
                        </div>

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
                                        <Icon className="fas fa-copy" /> Copy
                                    </button>
                                </div>

                                {copyState.copied && (
                                    <p className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1 font-medium">
                                        <Icon className="fas fa-check-circle" /> Link copied to clipboard! Paste this URL as a new calendar subscription in your calendar app.
                                    </p>
                                )}

                                {copyState.failed && (
                                    <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1 font-medium">
                                        <Icon className="fas fa-exclamation-triangle" /> Clipboard write was blocked by your browser. Please select and copy the URL manually above.
                                    </p>
                                )}

                                <div className="pt-3 border-t dark:border-gray-700">
                                    <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-xs text-red-800 dark:text-red-300 space-y-2">
                                        <div className="font-semibold flex items-center gap-1">
                                            <Icon className="fas fa-exclamation-circle" /> Resetting invalidates active links
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
                                        <Icon className="fas fa-check-circle" /> Calendar sync is active
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
                                    <Icon className={`fas fa-sync-alt ${isGeneratingToken ? 'fa-spin' : ''}`} />
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
                                    <Icon className={`fas fa-link ${isGeneratingToken ? 'fa-spin' : ''}`} />
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

            {/* Fixed Mobile Bottom Navigation Bar */}
            <nav aria-label="Mobile Navigation" className="lg:hidden fixed bottom-0 left-0 right-0 h-16 bg-white dark:bg-gray-800 border-t dark:border-gray-700 flex items-center justify-around px-1 z-40 shadow-lg">
                <button
                    onClick={() => handleNavigation('dashboard')}
                    className={`flex flex-col items-center justify-center flex-1 h-full py-1 text-xs font-medium transition-colors ${activeTab === 'dashboard' ? 'text-blue-600 dark:text-blue-400 font-bold' : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'}`}
                >
                    <Icon className="fas fa-calendar-alt text-lg mb-0.5" />
                    <span>Dashboard</span>
                </button>
                <button
                    onClick={() => handleNavigation('tools')}
                    className={`flex flex-col items-center justify-center flex-1 h-full py-1 text-xs font-medium transition-colors ${activeTab === 'tools' ? 'text-blue-600 dark:text-blue-400 font-bold' : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'}`}
                >
                    <Icon className="fas fa-microscope text-lg mb-0.5" />
                    <span>Equipment</span>
                </button>
                {profile?.access_level === 'admin' ? (
                    <button
                        onClick={() => handleNavigation('all_bookings')}
                        className={`flex flex-col items-center justify-center flex-1 h-full py-1 text-xs font-medium transition-colors ${activeTab === 'all_bookings' ? 'text-blue-600 dark:text-blue-400 font-bold' : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'}`}
                    >
                        <Icon className="fas fa-list-alt text-lg mb-0.5" />
                        <span>Bookings</span>
                    </button>
                ) : null}
                {profile?.access_level === 'admin' ? (
                    <button
                        onClick={() => handleNavigation('users')}
                        className={`flex flex-col items-center justify-center flex-1 h-full py-1 text-xs font-medium transition-colors ${activeTab === 'users' ? 'text-blue-600 dark:text-blue-400 font-bold' : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'}`}
                    >
                        <Icon className="fas fa-users-cog text-lg mb-0.5" />
                        <span>Users</span>
                    </button>
                ) : null}
                <button
                    onClick={() => setIsSidebarOpen(true)}
                    className="flex flex-col items-center justify-center flex-1 h-full py-1 text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"
                >
                    <Icon className="fas fa-bars text-lg mb-0.5" />
                    <span>Menu</span>
                </button>
            </nav>
        </div>
    );
};

export default Dashboard;
