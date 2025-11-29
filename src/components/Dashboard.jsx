import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../supabaseClient';
import { groupBookings } from '../utils/bookingUtils';
import BookingModal from './BookingModal';
import ToolList from './ToolList';
import BookingList from './BookingList';
import UserManagement from './UserManagement';
import { useToast } from '../context/ToastContext';

const Dashboard = ({ user, onLogout }) => {
    const [activeTab, setActiveTab] = useState('dashboard');
    const [tools, setTools] = useState([]);
    const [bookings, setBookings] = useState([]);
    const [profile, setProfile] = useState(null);
    const [selectedTool, setSelectedTool] = useState(null);
    const [loading, setLoading] = useState(true);

    const { showToast } = useToast();

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

    if (loading) {
        return <div className="flex items-center justify-center h-screen">Loading...</div>;
    }

    return (
        <div className="flex h-screen bg-gray-100">
            {/* Sidebar */}
            <div className="w-64 bg-white shadow-lg flex flex-col z-10">
                <div className="h-16 flex items-center justify-center border-b border-blue-900 bg-blue-900 text-white">
                    <div className="font-bold text-xl tracking-wider"><i className="fas fa-microscope mr-2"></i>MMI-LIMS</div>
                </div>

                <div className="p-4 border-b">
                    <div className="text-sm text-gray-500">Logged in as</div>
                    <div className="font-bold text-gray-800 truncate">
                        {profile ? `${profile.first_name} ${profile.last_name}` : user.email}
                    </div>
                    <div className="text-xs text-blue-600 font-semibold uppercase mt-1">
                        {profile?.job_title || 'Researcher'}
                        {profile?.access_level === 'admin' && <span className="ml-2 bg-red-600 text-white px-1 rounded text-[10px]">ADMIN</span>}
                    </div>
                </div>

                <nav className="flex-1 p-4 space-y-2">
                    <button onClick={() => setActiveTab('dashboard')} className={`w-full flex items-center p-3 rounded transition ${activeTab === 'dashboard' ? 'bg-blue-50 text-blue-700 font-bold' : 'text-gray-600 hover:bg-gray-50'}`}>
                        <i className="fas fa-home w-8"></i> Dashboard
                    </button>
                    <button onClick={() => setActiveTab('tools')} className={`w-full flex items-center p-3 rounded transition ${activeTab === 'tools' ? 'bg-blue-50 text-blue-700 font-bold' : 'text-gray-600 hover:bg-gray-50'}`}>
                        <i className="fas fa-tools w-8"></i> Tool List
                    </button>
                    <button onClick={() => setActiveTab('bookings')} className={`w-full flex items-center p-3 rounded transition ${activeTab === 'bookings' ? 'bg-blue-50 text-blue-700 font-bold' : 'text-gray-600 hover:bg-gray-50'}`}>
                        <i className="fas fa-calendar-alt w-8"></i> My Bookings
                        {myGroupedBookings.length > 0 && <span className="ml-auto bg-blue-600 text-white text-xs rounded-full px-2 py-0.5">{myGroupedBookings.length}</span>}
                    </button>
                    {profile?.access_level === 'admin' && (
                        <button onClick={() => setActiveTab('users')} className={`w-full flex items-center p-3 rounded transition ${activeTab === 'users' ? 'bg-blue-50 text-blue-700 font-bold' : 'text-gray-600 hover:bg-gray-50'}`}>
                            <i className="fas fa-users w-8"></i> Users
                        </button>
                    )}
                    {profile?.access_level === 'admin' && (
                        <button onClick={() => setActiveTab('all_bookings')} className={`w-full flex items-center p-3 rounded transition ${activeTab === 'all_bookings' ? 'bg-blue-50 text-blue-700 font-bold' : 'text-gray-600 hover:bg-gray-50'}`}>
                            <i className="fas fa-calendar-check w-8"></i> All Bookings
                        </button>
                    )}
                </nav>

                <div className="p-4 border-t">
                    <button onClick={onLogout} className="w-full flex items-center p-2 text-red-600 hover:bg-red-50 rounded transition">
                        <i className="fas fa-sign-out-alt w-8"></i> Logout
                    </button>
                </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 flex flex-col overflow-hidden">
                <header className="h-16 bg-white shadow-sm flex items-center justify-between px-6">
                    <h2 className="text-xl font-bold text-gray-800 capitalize">{activeTab.replace('-', ' ')}</h2>
                    <div className="flex items-center gap-4">
                        <span className="text-sm text-gray-500">Project: General</span>
                        <div className="h-8 w-8 bg-blue-900 rounded-full flex items-center justify-center text-white font-bold">
                            {user.email.charAt(0).toUpperCase()}
                        </div>
                    </div>
                </header>

                <main className="flex-1 overflow-y-auto p-6 custom-scroll">

                    {/* TAB: DASHBOARD */}
                    {activeTab === 'dashboard' && (
                        <div className="space-y-6">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                <div className="bg-white p-6 rounded-lg shadow-sm border">
                                    <h3 className="text-gray-500 text-sm font-bold uppercase mb-2">My Active Bookings</h3>
                                    <div className="text-3xl font-bold text-blue-900">{myGroupedBookings.length}</div>
                                </div>
                                <div className="bg-white p-6 rounded-lg shadow-sm border">
                                    <h3 className="text-gray-500 text-sm font-bold uppercase mb-2">Active Licenses</h3>
                                    <div className="text-3xl font-bold text-green-700">{profile?.licenses?.length || 0}</div>
                                </div>
                                <div className="bg-white p-6 rounded-lg shadow-sm border">
                                    <h3 className="text-gray-500 text-sm font-bold uppercase mb-2">Tools Down</h3>
                                    <div className="text-3xl font-bold text-red-600">{tools.filter(t => t.status === 'down').length}</div>
                                </div>
                            </div>

                            <div className="bg-white rounded-lg shadow-sm border">
                                <div className="p-4 border-b font-bold text-gray-800">
                                    Upcoming Bookings
                                </div>
                                <div className="p-4">
                                    {myGroupedBookings.length === 0 ? (
                                        <p className="text-gray-500 text-sm italic">No upcoming bookings.</p>
                                    ) : (
                                        <div className="space-y-2">
                                            {myGroupedBookings.slice(0, 5).map(b => (
                                                <div key={b.ids[0]} className="flex justify-between items-center p-3 bg-gray-50 rounded border-l-4 border-blue-500">
                                                    <div>
                                                        <div className="font-bold text-gray-800">{b.tool_name}</div>
                                                        <div className="text-xs text-gray-500">
                                                            {b.date} @ {b.startTime} - {b.endTime}
                                                        </div>
                                                    </div>
                                                    <button onClick={() => initiateCancel(b.ids)} className="text-red-500 hover:text-red-700 text-sm">
                                                        <i className="fas fa-times"></i>
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    )}
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

                    {/* TAB: BOOKINGS */}
                    {activeTab === 'bookings' && (
                        <BookingList
                            bookings={myBookings}
                            onCancel={initiateCancel}
                        />
                    )}

                    {/* TAB: ALL BOOKINGS (ADMIN ONLY) */}
                    {activeTab === 'all_bookings' && profile?.access_level === 'admin' && (
                        <BookingList
                            bookings={bookings}
                            onCancel={initiateCancel}
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
                    onClose={() => setSelectedTool(null)}
                    onConfirm={handleBookTool}
                />
            )}
        </div >
    );
};

export default Dashboard;
