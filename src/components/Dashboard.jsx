import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../supabaseClient';
import logo from '../assets/ktu_mmi.svg';
import { groupBookings, getNextSlotTime } from '../utils/bookingUtils';
import BookingModal from './BookingModal';
import ConfirmModal from './ConfirmModal';
import ToolList from './ToolList';
import BookingList from './BookingList';
import UserBookingsCalendar from './UserBookingsCalendar';
import UserManagement from './UserManagement';
import { useToast } from '../context/ToastContext';
import { useTheme } from '../context/ThemeContext';


const Dashboard = ({ user, onLogout }) => {
    const [activeTab, setActiveTab] = useState('dashboard');
    const [tools, setTools] = useState([]);
    const [bookings, setBookings] = useState([]);
    const [profile, setProfile] = useState(null);

    const [selectedTool, setSelectedTool] = useState(null);
    const [initialDate, setInitialDate] = useState(null);
    const [targetBooking, setTargetBooking] = useState(null);

    const [loading, setLoading] = useState(true);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [confirmModalOpen, setConfirmModalOpen] = useState(false);
    const [bookingIdToCancel, setBookingIdToCancel] = useState(null);

    // Week State
    const [currentWeekStart, setCurrentWeekStart] = useState(() => {
        const d = new Date();
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday
        return new Date(d.setDate(diff));
    });

    const { showToast } = useToast();
    const { theme, toggleTheme } = useTheme();

    // Fetch Data
    useEffect(() => {
        const fetchData = async (isBackground = false) => {
            if (!isBackground) setLoading(true);
            try {
                // Fetch Tools
                const { data: toolsData, error: toolsError } = await supabase
                    .from('tools')
                    .select('*')
                    .order('id', { ascending: true });

                if (toolsError) throw toolsError;
                if (toolsData) setTools(toolsData);

                // Fetch Profile
                const { data: profileData, error: profileError } = await supabase
                    .from('profiles')
                    .select('*')
                    .eq('id', user.id)
                    .single();

                if (profileError && profileError.code !== 'PGRST116') throw profileError; // Ignore not found if new user
                if (profileData) setProfile(profileData);

                // Fetch Bookings
                const { data: bookingsData, error: bookingsError } = await supabase
                    .from('bookings')
                    .select('*');

                if (bookingsError) throw bookingsError;
                if (bookingsData) setBookings(bookingsData);

            } catch (error) {
                console.error('Error fetching data:', error);
                // Only show toast on initial load to avoid spamming
                if (!isBackground) {
                    showToast('Error fetching data: ' + error.message, 'error');
                }
            } finally {
                if (!isBackground) setLoading(false);
            }
        };

        // Initial fetch
        fetchData();

        // Set up polling
        const intervalId = setInterval(() => {
            fetchData(true);
        }, 10000); // 10 seconds

        return () => clearInterval(intervalId);
    }, [user.id, showToast]);

    // Memoized grouped bookings
    const myBookings = bookings.filter(b => b.user_id === user.id);
    const myGroupedBookings = useMemo(() => groupBookings(myBookings), [bookings, user.id]);

    // Quick Book: Get last 3 unique tools used by the user
    const recentTools = useMemo(() => {
        const uniqueToolIds = new Set();
        const recent = [];
        // Sort bookings by date descending
        const sortedBookings = [...myBookings].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

        for (const booking of sortedBookings) {
            if (!uniqueToolIds.has(booking.tool_id)) {
                uniqueToolIds.add(booking.tool_id);
                // Find tool details
                const tool = tools.find(t => t.id === booking.tool_id);
                if (tool) recent.push(tool);
            }
            if (recent.length >= 3) break;
        }
        return recent;
    }, [myBookings, tools]);

    const handleBookTool = async (bookingData) => {
        const newBookings = Array.isArray(bookingData) ? bookingData : [bookingData];

        // Validate past bookings
        const now = new Date();
        const hasPastBooking = newBookings.some(b => {
            const bookingEnd = new Date(`${b.date}T${b.end_time || b.endTime}`);
            return bookingEnd < now;
        });

        const isAdminOverride = profile?.access_level === 'admin' && activeTab === 'all_bookings';

        if (hasPastBooking && !isAdminOverride) {
            showToast('Cannot create bookings in the past.', 'error');
            return;
        }

        try {
            const { data, error } = await supabase
                .from('bookings')
                .insert(newBookings)
                .select();

            if (error) throw error;

            setBookings([...bookings, ...data]);
            setSelectedTool(null);
            setInitialDate(null);
            showToast(`Successfully created ${data.length} booking(s).`);
        } catch (error) {
            console.error('Error creating booking:', error);
            showToast('Failed to create booking: ' + error.message, 'error');
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
        setConfirmModalOpen(true);
    };

    const handleConfirmCancel = async () => {
        if (!bookingIdToCancel) return;

        try {
            const { error } = await supabase
                .from('bookings')
                .delete()
                .in('id', bookingIdToCancel);

            if (error) throw error;

            setBookings(bookings.filter(b => !bookingIdToCancel.includes(b.id)));
            showToast("Booking has been cancelled.");
        } catch (error) {
            console.error('Error cancelling booking:', error);
            showToast('Failed to cancel booking.', 'error');
        } finally {
            setConfirmModalOpen(false);
            setBookingIdToCancel(null);
        }
    };

    const handleUpdateBooking = async (oldIds, newBookingData) => {
        try {
            // We expect a single booking ID for updates now, but we might receive multiple if it was a group
            const bookingId = oldIds[0];
            if (!bookingId) throw new Error("No booking ID provided for update");

            // If there are multiple IDs (legacy slots), we delete the extras and update the first one
            if (oldIds.length > 1) {
                const idsToDelete = oldIds.slice(1);
                const { error: deleteError } = await supabase
                    .from('bookings')
                    .delete()
                    .in('id', idsToDelete);

                if (deleteError) {
                    console.error("Error deleting secondary slots:", deleteError);
                    // Continue anyway to try to update the main one
                }
            }

            const bookingsToProcess = Array.isArray(newBookingData) ? newBookingData : [newBookingData];
            const newBooking = bookingsToProcess[0]; // We expect single booking update

            // Validate past bookings
            const now = new Date();
            const bookingEnd = new Date(`${newBooking.date}T${newBooking.end_time || newBooking.endTime}`);

            const isAdminOverride = profile?.access_level === 'admin' && activeTab === 'all_bookings';

            if (bookingEnd < now && !isAdminOverride) {
                throw new Error('Cannot move booking to the past.');
            }

            const updateData = {
                project: newBooking.project,
                date: newBooking.date,
                time: newBooking.startTime || newBooking.time,
                end_time: newBooking.endTime || newBooking.end_time,
            };

            const { data, error } = await supabase
                .from('bookings')
                .update(updateData)
                .eq('id', bookingId)
                .select();

            if (error) throw error;

            // Update local state
            setBookings(prev => {
                // Remove deleted ones (legacy handling)
                let updated = prev;
                if (oldIds.length > 1) {
                    updated = prev.filter(b => !oldIds.slice(1).includes(b.id));
                }
                // Update modified one
                return updated.map(b => b.id === bookingId ? { ...b, ...updateData } : b);
            });

            showToast("Booking updated successfully.");
        } catch (error) {
            console.error('Error updating booking:', error);
            showToast('Failed to update booking: ' + error.message, 'error');
        }
    };

    const handleStatusChange = async (toolId, newStatus) => {
        try {
            const { error } = await supabase
                .from('tools')
                .update({ status: newStatus })
                .eq('id', toolId);

            if (error) throw error;

            setTools(tools.map(t => t.id === toolId ? { ...t, status: newStatus } : t));
            showToast(`Tool status updated to ${newStatus}`);
        } catch (error) {
            console.error('Error updating status:', error);
            showToast('Failed to update status.', 'error');
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

    if (loading) {
        return <div className="flex items-center justify-center h-screen">Loading...</div>;
    }

    const handleNavigation = (tabName) => {
        setActiveTab(tabName);
        setIsSidebarOpen(false);
    };

    return (
        <div className="flex h-screen bg-gray-100">
            {/* Mobile Sidebar Overlay */}
            {isSidebarOpen && (
                <div
                    className="fixed inset-0 bg-black/50 z-40 lg:hidden"
                    onClick={() => setIsSidebarOpen(false)}
                ></div>
            )}

            {/* Sidebar */}
            <div className={`fixed inset-y-0 left-0 z-50 w-64 bg-white dark:bg-gray-800 shadow-lg flex flex-col transition-transform duration-300 ease-in-out lg:translate-x-0 lg:static lg:inset-auto ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
                <div className="h-16 flex items-center justify-center border-b border-blue-900 bg-blue-900 dark:bg-blue-950 text-white transition-colors">
                    <div className="font-bold text-xl tracking-wider flex items-center">
                        <img src={logo} alt="Logo" className="h-8 mr-2 brightness-0 invert" />
                        MMI-LIMS
                    </div>
                </div>

                <div className="p-4 border-b dark:border-gray-700">
                    <div className="text-sm text-gray-500 dark:text-gray-400">Logged in as</div>
                    <div className="font-bold text-gray-800 dark:text-gray-200 truncate">
                        {profile ? `${profile.first_name} ${profile.last_name}` : user.email}
                    </div>
                    <div className="text-xs text-blue-600 dark:text-blue-400 font-semibold uppercase mt-1">
                        {profile?.job_title || 'Researcher'}
                        {profile?.access_level === 'admin' && <span className="ml-2 bg-red-600 text-white px-1 rounded text-[10px]">ADMIN</span>}
                    </div>
                </div>

                <nav className="flex-1 p-4 space-y-2">
                    <button onClick={() => handleNavigation('dashboard')} className={`w-full flex items-center p-3 rounded transition ${activeTab === 'dashboard' ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 font-bold' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'}`}>
                        <i className="fas fa-home w-8"></i> Dashboard
                    </button>
                    <button onClick={() => handleNavigation('tools')} className={`w-full flex items-center p-3 rounded transition ${activeTab === 'tools' ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 font-bold' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'}`}>
                        <i className="fas fa-tools w-8"></i> Tool List
                    </button>

                    {profile?.access_level === 'admin' && (
                        <button onClick={() => handleNavigation('users')} className={`w-full flex items-center p-3 rounded transition ${activeTab === 'users' ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 font-bold' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'}`}>
                            <i className="fas fa-users w-8"></i> Users
                        </button>
                    )}
                    {profile?.access_level === 'admin' && (
                        <button onClick={() => handleNavigation('all_bookings')} className={`w-full flex items-center p-3 rounded transition ${activeTab === 'all_bookings' ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 font-bold' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'}`}>
                            <i className="fas fa-calendar-check w-8"></i> All Bookings
                        </button>
                    )}
                </nav>

                <div className="p-4 border-t dark:border-gray-700 space-y-2">
                    <button onClick={toggleTheme} className="w-full flex items-center p-2 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 rounded transition">
                        <i className={`fas ${theme === 'dark' ? 'fa-sun' : 'fa-moon'} w-8`}></i> {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
                    </button>
                    <button onClick={onLogout} className="w-full flex items-center p-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition">
                        <i className="fas fa-sign-out-alt w-8"></i> Logout
                    </button>
                </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 flex flex-col overflow-hidden bg-gray-100 dark:bg-gray-900 transition-colors">
                <header className="h-16 bg-white dark:bg-gray-800 shadow-sm flex items-center justify-between px-6 transition-colors">
                    <div className="flex items-center gap-4">
                        <button
                            onClick={() => setIsSidebarOpen(true)}
                            className="lg:hidden text-gray-600 dark:text-gray-300 hover:text-blue-900 dark:hover:text-blue-400"
                        >
                            <i className="fas fa-bars text-xl"></i>
                        </button>
                        <h2 className="text-xl font-bold text-gray-800 dark:text-white capitalize">{activeTab.replace('-', ' ')}</h2>
                    </div>

                </header>

                <main className="flex-1 overflow-y-auto p-6 custom-scroll">

                    {/* TAB: DASHBOARD */}
                    {activeTab === 'dashboard' && (
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-full">
                            {/* Left Column: My Bookings Calendar (2/3 width) */}
                            <div className="lg:col-span-2 flex flex-col">
                                <h3 className="font-bold text-gray-800 dark:text-gray-200 mb-4">My Bookings Calendar</h3>
                                <UserBookingsCalendar
                                    bookings={myBookings}
                                    allBookings={bookings}
                                    onUpdate={handleUpdateBooking}
                                    currentWeekStart={currentWeekStart}
                                    onWeekChange={setCurrentWeekStart}
                                    onBookingClick={handleBookingClick}
                                />
                            </div>

                            {/* Right Column: Panels (1/3 width) */}
                            <div className="lg:col-span-1 flex flex-col gap-6">

                                {/* Panel 1: Quick Book */}
                                <div className="flex flex-col">
                                    <h3 className="font-bold text-gray-800 dark:text-gray-200 mb-4">Quick Book</h3>
                                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border dark:border-gray-700 transition-colors flex flex-col max-h-[350px]">
                                        <div className="overflow-y-auto p-4 custom-scroll">
                                            {recentTools.length > 0 ? (
                                                <div className="grid grid-cols-1 gap-4">
                                                    {recentTools.map(tool => (
                                                        <div key={tool.id} className="bg-gray-50 dark:bg-gray-900 p-3 rounded-lg border dark:border-gray-700 hover:shadow-md transition cursor-pointer flex justify-between items-center group" onClick={() => setSelectedTool(tool)}>
                                                            <div>
                                                                <div className="font-bold text-sm text-gray-800 dark:text-gray-200 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">{tool.name}</div>
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
                                                    No recent tools found.
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* Panel 2: Upcoming Bookings */}
                                <div className="flex flex-col">
                                    <h3 className="font-bold text-gray-800 dark:text-gray-200 mb-4">Upcoming Bookings</h3>
                                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border dark:border-gray-700 transition-colors flex flex-col max-h-[350px]">
                                        <div className="overflow-y-auto p-4 custom-scroll">
                                            <BookingList
                                                bookings={myBookings.filter(b => {
                                                    const end = new Date(`${b.date}T${b.end_time || b.endTime}`);
                                                    return end >= new Date();
                                                })}
                                                allBookings={bookings}
                                                onCancel={initiateCancel}
                                                onUpdate={handleUpdateBooking}
                                                onEdit={handleBookingClick}
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* Panel 3: Past Bookings */}
                                <div className="flex flex-col">
                                    <h3 className="font-bold text-gray-600 dark:text-gray-400 mb-4">Past Bookings</h3>
                                    <div className="bg-gray-50 dark:bg-gray-900 rounded-lg shadow-sm border dark:border-gray-700 transition-colors flex flex-col max-h-[350px]">
                                        <div className="overflow-y-auto p-4 custom-scroll">
                                            <BookingList
                                                bookings={myBookings.filter(b => {
                                                    const end = new Date(`${b.date}T${b.end_time || b.endTime}`);
                                                    return end < new Date();
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
                            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border dark:border-gray-700 p-4 transition-colors">
                                <BookingList
                                    bookings={bookings}
                                    onCancel={initiateCancel}
                                    onUpdate={handleUpdateBooking}
                                    onEdit={handleBookingClick}
                                    isAdminView={true}
                                />
                            </div>
                        </div>
                    )}

                    {/* TAB: USERS (ADMIN ONLY) */}
                    {activeTab === 'users' && profile?.access_level === 'admin' && (
                        <UserManagement
                            tools={tools}
                            currentUser={user}
                            onProfileUpdate={async () => {
                                const { data } = await supabase
                                    .from('profiles')
                                    .select('*')
                                    .eq('id', user.id)
                                    .single();
                                if (data) setProfile(data);
                            }}
                        />
                    )}

                </main >
            </div >

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
            />
        </div >
    );
};

export default Dashboard;
