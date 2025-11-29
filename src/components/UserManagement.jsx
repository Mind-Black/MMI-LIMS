import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { useToast } from '../context/ToastContext';

const UserManagement = ({ tools }) => {
    const [allUsers, setAllUsers] = useState([]);
    const [selectedUser, setSelectedUser] = useState(null);
    const { showToast } = useToast();

    // Fetch All Users
    useEffect(() => {
        const fetchUsers = async () => {
            console.log('Fetching all users...');
            const { data, error } = await supabase.from('profiles').select('*').order('last_name', { ascending: true });
            if (error) {
                console.error('Error fetching users:', error);
                showToast('Failed to fetch users', 'error');
            } else {
                console.log('Fetched users:', data);
                setAllUsers(data);
            }
        };
        fetchUsers();
    }, [showToast]);

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
            showToast('Licenses updated successfully.');
        } catch (error) {
            console.error('Error updating licenses:', error);
            showToast('Failed to update licenses: ' + error.message, 'error');
        }
    };

    return (
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
    );
};

export default UserManagement;
