import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../supabaseClient';
import logo from '../assets/ktu_mmi.svg';
import { groupBookings, getNextSlotTime } from '../utils/bookingUtils';
import BookingModal from './BookingModal';
import ToolList from './ToolList';
import BookingList from './BookingList';
import UserManagement from './UserManagement';
import { useToast } from '../context/ToastContext';
import { useTheme } from '../context/ThemeContext';
import AnalyticsCharts from './AnalyticsCharts';

const Dashboard = ({ user, onLogout }) => {
    const [activeTab, setActiveTab] = useState('dashboard');
    const [tools, setTools] = useState([]);
    const [bookings, setBookings] = useState([]);
    const [profile, setProfile] = useState(null);

    const [selectedTool, setSelectedTool] = useState(null);
    const [initialDate, setInitialDate] = useState(null);

    const [loading, setLoading] = useState(true);

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
        const fetchData = async () => {
            setLoading(true);
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
                showToast('Error fetching data: ' + error.message, 'error');
            } finally {
                setLoading(false);
            }
        };

        fetchData();
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

    const initiateCancel = async (ids) => {
        if (!confirm('Are you sure you want to cancel this booking?')) return;

        try {
            const { error } = await supabase
                .from('bookings')
                .delete()
                .in('id', ids);

            if (error) throw error;

            setBookings(bookings.filter(b => !ids.includes(b.id)));
            showToast("Booking has been cancelled.");
        } catch (error) {
            console.error('Error cancelling booking:', error);
            showToast('Failed to cancel booking.', 'error');
        }
    };

    const handleUpdateBooking = async (oldIds, newBookingData) => {
        try {
            // 1. Delete old slots
            const { error: deleteError, count: deletedCount } = await supabase
                .from('bookings')
                .delete({ count: 'exact' })
                .in('id', oldIds);

            console.log(`Deleted ${deletedCount} bookings with IDs:`, oldIds);

            if (deleteError) throw deleteError;
            if (deletedCount !== oldIds.length) {
                console.warn(`Expected to delete ${oldIds.length} rows, but deleted ${deletedCount}`);
                throw new Error(`Permission denied: Could not delete old booking. (Deleted ${deletedCount}/${oldIds.length})`);
            }

            // 2. Insert new slots
            // Ensure new slots have all required fields (user_id, tool_id, etc.)
            // We can get these from one of the old bookings (assuming they are consistent)
            const oldBooking = bookings.find(b => b.id === oldIds[0]);
            if (!oldBooking) throw new Error("Original booking not found");

            const bookingsToProcess = Array.isArray(newBookingData) ? newBookingData : [newBookingData];

            const bookingsToInsert = bookingsToProcess.map(b => ({
                tool_id: oldBooking.tool_id,
                tool_name: oldBooking.tool_name,
                user_id: oldBooking.user_id,
                user_name: oldBooking.user_name,
                project: oldBooking.project,
                date: b.date,
                time: b.startTime || b.time,
                end_time: b.endTime || b.end_time,
                created_at: oldBooking.created_at
            }));

            const { data: insertedData, error: insertError } = await supabase
                .from('bookings')
                .insert(bookingsToInsert)
                .select();

            if (insertError) throw insertError;

            // 3. Update local state
            // Remove old
            const filteredBookings = bookings.filter(b => !oldIds.includes(b.id));
            // Add new
            setBookings([...filteredBookings, ...insertedData]);

            showToast("Booking updated successfully.");
        } catch (error) {
            console.error('Error updating booking:', error);
            showToast('Failed to update booking: ' + error.message, 'error');
            // Ideally we should revert state here if partial failure, but for now we rely on user refresh or manual fix
            // A transaction would be better but Supabase JS client doesn't support transactions directly on client side easily without RPC
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
        } else {
            showToast('Tool details not found.', 'error');
        }
    };

    if (loading) {
        return <div className="flex items-center justify-center h-screen">Loading...</div>;
    }

    return (
        <div className="flex h-screen bg-gray-100">
            {/* Sidebar */}
            <div className="w-64 bg-white dark:bg-gray-800 shadow-lg flex flex-col z-10 transition-colors">
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
                    <button onClick={() => setActiveTab('dashboard')} className={`w-full flex items-center p-3 rounded transition ${activeTab === 'dashboard' ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 font-bold' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'}`}>
                        <i className="fas fa-home w-8"></i> Dashboard
                    </button>
                    <button onClick={() => setActiveTab('tools')} className={`w-full flex items-center p-3 rounded transition ${activeTab === 'tools' ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 font-bold' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'}`}>
                        <i className="fas fa-tools w-8"></i> Tool List
                    </button>

                    {profile?.access_level === 'admin' && (
                        <button onClick={() => setActiveTab('users')} className={`w-full flex items-center p-3 rounded transition ${activeTab === 'users' ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 font-bold' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'}`}>
                            <i className="fas fa-users w-8"></i> Users
                        </button>
                    )}
                    {profile?.access_level === 'admin' && (
                        <button onClick={() => setActiveTab('all_bookings')} className={`w-full flex items-center p-3 rounded transition ${activeTab === 'all_bookings' ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 font-bold' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'}`}>
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
                    <h2 className="text-xl font-bold text-gray-800 dark:text-white capitalize">{activeTab.replace('-', ' ')}</h2>
                    <div className="flex items-center gap-4">
                        <span className="text-sm text-gray-500 dark:text-gray-400">Project: General</span>
                        <div className="h-8 w-8 bg-blue-900 dark:bg-blue-700 rounded-full flex items-center justify-center text-white font-bold">
                            {user.email.charAt(0).toUpperCase()}
                        </div>
                    </div>
                </header>

                <main className="flex-1 overflow-y-auto p-6 custom-scroll">

                    {/* TAB: DASHBOARD */}
                    {activeTab === 'dashboard' && (
                        <div className="space-y-6">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                {/* Analytics Chart */}
                                <div className="md:col-span-2">
                                    <AnalyticsCharts bookings={bookings} currentWeekStart={currentWeekStart} />
                                </div>

                                {/* Stats Cards - Removed per request */}
                            </div>

                            {/* Quick Book Section */}
                            {recentTools.length > 0 && (
                                <div>
                                    <h3 className="font-bold text-gray-800 dark:text-gray-200 mb-4">Quick Book</h3>
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                        {recentTools.map(tool => (
                                            <div key={tool.id} className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-sm border dark:border-gray-700 hover:shadow-md transition cursor-pointer flex justify-between items-center group" onClick={() => setSelectedTool(tool)}>
                                                <div>
                                                    <div className="font-bold text-gray-800 dark:text-gray-200 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">{tool.name}</div>
                                                    <div className="text-xs text-gray-500 dark:text-gray-400">{tool.category}</div>
                                                </div>
                                                <div className="h-8 w-8 bg-blue-50 dark:bg-blue-900/30 rounded-full flex items-center justify-center text-blue-600 dark:text-blue-400 group-hover:bg-blue-100 dark:group-hover:bg-blue-800/50 transition-colors">
                                                    <i className="fas fa-plus"></i>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border dark:border-gray-700 p-4 transition-colors">
                                <h3 className="font-bold text-gray-800 dark:text-gray-200 mb-4">My Bookings</h3>
                                <BookingList
                                    bookings={myBookings}
                                    allBookings={bookings}
                                    onCancel={initiateCancel}
                                    onUpdate={handleUpdateBooking}
                                    onBookingClick={handleBookingClick}
                                    currentWeekStart={currentWeekStart}
                                    onWeekChange={setCurrentWeekStart}
                                />
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
                        <BookingList
                            bookings={bookings}
                            onCancel={initiateCancel}
                            onUpdate={handleUpdateBooking}
                            isAdminView={true}
                        />
                    )}

                    {/* TAB: USERS (ADMIN ONLY) */}
                    {activeTab === 'users' && profile?.access_level === 'admin' && (
                        <UserManagement tools={tools} />
                    )}

                </main>
            </div >

            {selectedTool && (
                <BookingModal
                    tool={selectedTool}
                    user={user}
                    profile={profile}
                    existingBookings={bookings}
                    initialDate={initialDate}
                    onClose={() => { setSelectedTool(null); setInitialDate(null); }}
                    onConfirm={handleBookTool}
                    onUpdate={handleUpdateBooking}
                />
            )}
        </div >
    );
};

export default Dashboard;
