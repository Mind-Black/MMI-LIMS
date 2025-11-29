import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../supabaseClient';
import { groupBookings } from '../utils/bookingUtils';
import StatusBadge from './StatusBadge';
import BookingModal from './BookingModal';
import UserBookingsCalendar from './UserBookingsCalendar';
import Toast from './Toast';

const Dashboard = ({ user, onLogout }) => {
    const [activeTab, setActiveTab] = useState('dashboard');
    const [tools, setTools] = useState([]);
    const [bookings, setBookings] = useState([]);
    const [profile, setProfile] = useState(null);
    const [allUsers, setAllUsers] = useState([]);
    const [selectedUser, setSelectedUser] = useState(null);
    const [selectedTool, setSelectedTool] = useState(null);
    const [filterCategory, setFilterCategory] = useState('All');
    const [searchQuery, setSearchQuery] = useState('');
    const [toastMessage, setToastMessage] = useState(null);
    const [loading, setLoading] = useState(true);

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
                // Fallback for demo if DB is empty or connection fails
                // In a real app, we'd show an error state
            } finally {
                setLoading(false);
            }
        };

        fetchData();

        // Real-time subscription could go here
    }, []);

    // Fetch All Users if Admin
    useEffect(() => {
        console.log('Checking admin access for user fetch:', profile?.access_level);
        if (profile?.access_level === 'admin') {
            const fetchUsers = async () => {
                console.log('Fetching all users...');
                const { data, error } = await supabase.from('profiles').select('*').order('last_name', { ascending: true });
                if (error) {
                    console.error('Error fetching users:', error);
                } else {
                    console.log('Fetched users:', data);
                    setAllUsers(data);
                }
            };
            fetchUsers();
        }
    }, [profile]);

    // Memoized grouped bookings
    const myBookings = bookings.filter(b => b.user_id === user.id);
    const myGroupedBookings = useMemo(() => groupBookings(myBookings), [bookings, user.id]);
    const allGroupedBookings = useMemo(() => groupBookings(bookings), [bookings]);

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
            setToastMessage(`Successfully created ${data.length} booking(s).`);
        } catch (error) {
            console.error('Error creating booking:', error);
            setToastMessage('Failed to create booking: ' + error.message);
        }
    };

    const initiateCancel = async (ids) => {
        // Allow admin to cancel any booking, or user to cancel their own
        // In real app, RLS handles permission, but we can check here too for UI feedback
        if (!confirm('Are you sure you want to cancel this booking?')) return;

        try {
            const { error } = await supabase
                .from('bookings')
                .delete()
                .in('id', ids);

            if (error) throw error;

            setBookings(bookings.filter(b => !ids.includes(b.id)));
            setToastMessage("Booking has been cancelled.");
        } catch (error) {
            console.error('Error cancelling booking:', error);
            setToastMessage('Failed to cancel booking.');
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
            setToastMessage(`Tool status updated to ${newStatus}`);
        } catch (error) {
            console.error('Error updating status:', error);
            setToastMessage('Failed to update status.');
        }
    };

    const handleLicenseToggle = async (userId, toolId) => {
        const userToUpdate = allUsers.find(u => u.id === userId);
        if (!userToUpdate) return;

        const currentLicenses = userToUpdate.licenses || [];
        let newLicenses;

        if (currentLicenses.includes(toolId)) {
            newLicenses = currentLicenses.filter(id => id !== toolId);
        } else {
            newLicenses = [...currentLicenses, toolId];
        }

        try {
            console.log(`Updating licenses for user ${userId} to:`, newLicenses);
            const { data, error } = await supabase
                .from('profiles')
                .update({ licenses: newLicenses })
                .eq('id', userId)
                .select();

            if (error) {
                console.error('Supabase update error:', error);
                throw error;
            }

            console.log('Supabase update success:', data);

            // Update local state
            setAllUsers(allUsers.map(u => u.id === userId ? { ...u, licenses: newLicenses } : u));
            if (selectedUser?.id === userId) {
                setSelectedUser({ ...selectedUser, licenses: newLicenses });
            }
            setToastMessage('Licenses updated successfully.');
        } catch (error) {
            console.error('Error updating licenses:', error);
            setToastMessage('Failed to update licenses: ' + error.message);
        }
    };

    const categories = useMemo(() => {
        const cats = new Set(tools.map(t => t.category));
        return ['All', ...Array.from(cats).sort()];
    }, [tools]);

    const filteredTools = tools.filter(t => {
        const matchesCategory = filterCategory === 'All' || t.category === filterCategory;
        const matchesSearch = t.name.toLowerCase().includes(searchQuery.toLowerCase()) || t.id.toString().includes(searchQuery);
        return matchesCategory && matchesSearch;
    });

    const authorizedTools = filteredTools.filter(t => !t.license_req || profile?.licenses?.includes(t.id));
    const otherTools = filteredTools.filter(t => t.license_req && !profile?.licenses?.includes(t.id));

    const ToolTable = ({ toolsList, title }) => (
        <div className="bg-white rounded shadow-sm overflow-hidden border mb-8">
            <div className="p-4 bg-gray-50 border-b font-bold text-gray-700">{title} ({toolsList.length})</div>
            <table className="w-full text-left border-collapse">
                <thead className="bg-gray-50 border-b">
                    <tr>
                        <th className="p-4 font-semibold text-gray-600">ID</th>
                        <th className="p-4 font-semibold text-gray-600">Name</th>
                        <th className="p-4 font-semibold text-gray-600">Category</th>
                        <th className="p-4 font-semibold text-gray-600">Status</th>
                        <th className="p-4 font-semibold text-gray-600">License</th>
                        <th className="p-4 font-semibold text-gray-600 text-right">Action</th>
                    </tr>
                </thead>
                <tbody>
                    {toolsList.map(tool => (
                        <tr key={tool.id} className="tool-row border-b last:border-0 transition">
                            <td className="p-4 text-gray-500 font-mono text-sm">{tool.id}</td>
                            <td className="p-4">
                                <div className="font-bold text-gray-800">{tool.name}</div>
                                <div className="text-xs text-gray-500">{tool.description}</div>
                            </td>
                            <td className="p-4">
                                <span className="bg-blue-50 text-blue-700 px-2 py-1 rounded text-xs font-semibold">
                                    {tool.category}
                                </span>
                            </td>
                            <td className="p-4">
                                <div className="flex items-center gap-2">
                                    <StatusBadge status={tool.status} />
                                    {profile?.access_level === 'admin' && (
                                        <select
                                            value={tool.status}
                                            onChange={(e) => handleStatusChange(tool.id, e.target.value)}
                                            className="text-xs border rounded p-1 bg-white"
                                            onClick={(e) => e.stopPropagation()}
                                        >
                                            <option value="up">Up</option>
                                            <option value="down">Down</option>
                                            <option value="service">Service</option>
                                        </select>
                                    )}
                                </div>
                            </td>
                            <td className="p-4">
                                {!tool.license_req ? (
                                    <span className="text-green-600 text-xs font-bold bg-green-50 px-2 py-1 rounded">Not Required</span>
                                ) : profile?.licenses?.includes(tool.id) ? (
                                    <span className="text-green-700 font-bold flex items-center gap-1 text-sm"><i className="fas fa-check-circle"></i> Active</span>
                                ) : (
                                    <span className="text-gray-400 flex items-center gap-1 text-sm"><i className="fas fa-times-circle"></i> Missing</span>
                                )}
                            </td>
                            <td className="p-4 text-right">
                                <button
                                    onClick={() => setSelectedTool(tool)}
                                    className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 text-sm font-medium shadow-sm"
                                >
                                    Book
                                </button>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
            {toolsList.length === 0 && (
                <div className="p-8 text-center text-gray-500">
                    No tools found in this section.
                </div>
            )}
        </div>
    );

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
                        <div className="space-y-4">
                            <div className="flex flex-col md:flex-row gap-4 bg-white p-4 rounded shadow-sm">
                                <div className="flex-1">
                                    <input
                                        type="text"
                                        placeholder="Search tool name or ID..."
                                        className="w-full border p-2 rounded focus:ring-2 focus:ring-blue-500 outline-none"
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                    />
                                </div>
                                <select
                                    className="border p-2 rounded"
                                    value={filterCategory}
                                    onChange={(e) => setFilterCategory(e.target.value)}
                                >
                                    {categories.map(c => <option key={c} value={c}>{c}</option>)}
                                </select>
                            </div>

                            <ToolTable toolsList={authorizedTools} title="My Authorized Tools" />
                            <ToolTable toolsList={otherTools} title="Other Tools" />
                        </div>
                    )}


                    {/* TAB: BOOKINGS */}
                    {activeTab === 'bookings' && (
                        <div className="space-y-6">
                            <UserBookingsCalendar bookings={myBookings} />

                            <h3 className="font-bold text-gray-800 pt-4 border-t">Booking List</h3>
                            {myGroupedBookings.length === 0 ? (
                                <p className="text-gray-500">No bookings found.</p>
                            ) : (
                                <div className="space-y-2">
                                    {myGroupedBookings.map(b => (
                                        <div key={b.ids[0]} className="bg-white p-4 rounded shadow-sm border flex justify-between items-center">
                                            <div>
                                                <div className="font-bold text-blue-900">{b.tool_name}</div>
                                                <div className="text-sm text-gray-600">{b.date} | {b.startTime} - {b.endTime}</div>
                                            </div>
                                            <button onClick={() => initiateCancel(b.ids)} className="text-red-500 hover:text-red-700 text-sm font-semibold">
                                                Cancel
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* TAB: ALL BOOKINGS (ADMIN ONLY) */}
                    {activeTab === 'all_bookings' && profile?.access_level === 'admin' && (
                        <div className="space-y-6">
                            <UserBookingsCalendar bookings={bookings} />

                            <h3 className="font-bold text-gray-800 pt-4 border-t">All Bookings List</h3>
                            {allGroupedBookings.length === 0 ? (
                                <p className="text-gray-500">No bookings found in the system.</p>
                            ) : (
                                <div className="space-y-2">
                                    {allGroupedBookings.map(b => (
                                        <div key={b.ids[0]} className="bg-white p-4 rounded shadow-sm border flex justify-between items-center">
                                            <div>
                                                <div className="font-bold text-blue-900">{b.tool_name}</div>
                                                <div className="text-sm text-gray-600">
                                                    <span className="font-semibold text-gray-800">{b.user_name}</span> | {b.date} | {b.startTime} - {b.endTime}
                                                </div>
                                                <div className="text-xs text-gray-500">Project: {b.project}</div>
                                            </div>
                                            <button onClick={() => initiateCancel(b.ids)} className="text-red-500 hover:text-red-700 text-sm font-semibold border border-red-200 px-3 py-1 rounded hover:bg-red-50">
                                                Delete Booking
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* TAB: USERS (ADMIN ONLY) */}
                    {activeTab === 'users' && profile?.access_level === 'admin' && (
                        <div className="space-y-6">
                            <h3 className="font-bold text-gray-800">User Management</h3>
                            <div className="bg-white rounded shadow-sm overflow-hidden border">
                                <table className="w-full text-left border-collapse">
                                    <thead className="bg-gray-50 border-b">
                                        <tr>
                                            <th className="p-4 font-semibold text-gray-600">Name</th>
                                            <th className="p-4 font-semibold text-gray-600">Job Title</th>
                                            <th className="p-4 font-semibold text-gray-600">Access</th>
                                            <th className="p-4 font-semibold text-gray-600">Licenses</th>
                                            <th className="p-4 font-semibold text-gray-600 text-right">Action</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {allUsers.map(u => (
                                            <tr key={u.id} className="border-b last:border-0 hover:bg-gray-50 transition">
                                                <td className="p-4 font-bold text-gray-800">{u.first_name} {u.last_name}</td>
                                                <td className="p-4 text-gray-600">{u.job_title}</td>
                                                <td className="p-4">
                                                    <span className={`px-2 py-1 rounded text-xs font-bold uppercase ${u.access_level === 'admin' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>
                                                        {u.access_level}
                                                    </span>
                                                </td>
                                                <td className="p-4 text-gray-600">{u.licenses?.length || 0}</td>
                                                <td className="p-4 text-right">
                                                    <button
                                                        onClick={() => setSelectedUser(selectedUser?.id === u.id ? null : u)}
                                                        className="text-blue-600 hover:text-blue-800 font-semibold text-sm"
                                                    >
                                                        {selectedUser?.id === u.id ? 'Close' : 'Manage'}
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            {selectedUser && (
                                <div className="bg-white p-6 rounded shadow-sm border border-blue-200 animate-fade-in">
                                    <h4 className="font-bold text-lg text-gray-800 mb-4">
                                        Manage Licenses for {selectedUser.first_name} {selectedUser.last_name}
                                    </h4>
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                        {tools.map(tool => {
                                            const hasLicense = selectedUser.licenses?.includes(tool.id);
                                            return (
                                                <div key={tool.id} className={`p-3 rounded border flex items-center justify-between cursor-pointer transition ${hasLicense ? 'bg-green-50 border-green-200' : 'bg-gray-50 hover:bg-gray-100'}`}
                                                    onClick={() => handleLicenseToggle(selectedUser.id, tool.id)}
                                                >
                                                    <span className="font-medium text-gray-700">{tool.name}</span>
                                                    {hasLicense ? <i className="fas fa-check-circle text-green-600 text-xl"></i> : <i className="far fa-circle text-gray-400 text-xl"></i>}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                        </div>
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

            {
                toastMessage && (
                    <Toast
                        message={toastMessage}
                        onClose={() => setToastMessage(null)}
                    />
                )
            }
        </div >
    );
};

export default Dashboard;
