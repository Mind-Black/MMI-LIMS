import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { useToast } from '../context/ToastContext';

const UserManagement = ({ tools, currentUser, onProfileUpdate }) => {
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
            if (currentUser && currentUser.id === userId && onProfileUpdate) {
                onProfileUpdate();
            }
            showToast('Licenses updated successfully.');
        } catch (error) {
            console.error('Error updating licenses:', error);
            showToast('Failed to update licenses: ' + error.message, 'error');
        }
    };

    const handleApproveUser = async (userId) => {
        try {
            const { error } = await supabase
                .from('profiles')
                .update({ is_approved: true })
                .eq('id', userId);

            if (error) throw error;

            setAllUsers(allUsers.map(u => u.id === userId ? { ...u, is_approved: true } : u));
            showToast('User approved successfully.');
        } catch (error) {
            console.error('Error approving user:', error);
            showToast('Failed to approve user: ' + error.message, 'error');
        }
    };

    const handleProjectAdd = async (userId, projectName) => {
        const userToUpdate = allUsers.find(u => u.id === userId);
        if (!userToUpdate) return;

        const currentProjects = userToUpdate.projects || [];
        if (currentProjects.includes(projectName)) {
            showToast('Project already assigned.', 'error');
            return;
        }

        const newProjects = [...currentProjects, projectName];

        try {
            const { error } = await supabase
                .from('profiles')
                .update({ projects: newProjects })
                .eq('id', userId);

            if (error) throw error;

            // Update local state
            setAllUsers(allUsers.map(u => u.id === userId ? { ...u, projects: newProjects } : u));
            if (selectedUser?.id === userId) {
                setSelectedUser({ ...selectedUser, projects: newProjects });
            }
            if (currentUser && currentUser.id === userId && onProfileUpdate) {
                onProfileUpdate();
            }
            showToast('Project added successfully.');
        } catch (error) {
            console.error('Error adding project:', error);
            showToast('Failed to add project: ' + error.message, 'error');
        }
    };

    const handleProjectRemove = async (userId, projectName) => {
        const userToUpdate = allUsers.find(u => u.id === userId);
        if (!userToUpdate) return;

        const newProjects = (userToUpdate.projects || []).filter(p => p !== projectName);

        try {
            const { error } = await supabase
                .from('profiles')
                .update({ projects: newProjects })
                .eq('id', userId);

            if (error) throw error;

            // Update local state
            setAllUsers(allUsers.map(u => u.id === userId ? { ...u, projects: newProjects } : u));
            if (selectedUser?.id === userId) {
                setSelectedUser({ ...selectedUser, projects: newProjects });
            }
            if (currentUser && currentUser.id === userId && onProfileUpdate) {
                onProfileUpdate();
            }
            showToast('Project removed successfully.');
        } catch (error) {
            console.error('Error removing project:', error);
            showToast('Failed to remove project: ' + error.message, 'error');
        }
    };

    return (
        <div className="space-y-6">
            <h3 className="font-bold text-gray-800 dark:text-gray-200 transition-colors">User Management</h3>
            <div className="bg-white dark:bg-gray-800 rounded shadow-sm overflow-hidden border dark:border-gray-700 transition-colors">
                <table className="w-full text-left border-collapse">
                    <thead className="bg-gray-50 dark:bg-gray-900 border-b dark:border-gray-700 transition-colors">
                        <tr>
                            <th className="p-4 font-semibold text-gray-600 dark:text-gray-300">Name</th>
                            <th className="p-4 font-semibold text-gray-600 dark:text-gray-300">Job Title</th>
                            <th className="p-4 font-semibold text-gray-600 dark:text-gray-300">Access</th>
                            <th className="p-4 font-semibold text-gray-600 dark:text-gray-300">Status</th>
                            <th className="p-4 font-semibold text-gray-600 dark:text-gray-300">Licenses</th>
                            <th className="p-4 font-semibold text-gray-600 dark:text-gray-300 text-right">Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        {allUsers.map(u => (
                            <tr key={u.id} className="border-b dark:border-gray-700 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                                <td className="p-4 font-bold text-gray-800 dark:text-gray-200">{u.first_name} {u.last_name}</td>
                                <td className="p-4 text-gray-600 dark:text-gray-400">{u.job_title}</td>
                                <td className="p-4">
                                    <span className={`px-2 py-1 rounded text-xs font-bold uppercase ${u.access_level === 'admin' ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300' : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'}`}>
                                        {u.access_level}
                                    </span>
                                </td>
                                <td className="p-4">
                                    {u.is_approved ? (
                                        <span className="px-2 py-1 rounded text-xs font-bold uppercase bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300">Active</span>
                                    ) : (
                                        <button
                                            onClick={() => handleApproveUser(u.id)}
                                            className="px-2 py-1 rounded text-xs font-bold uppercase bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 hover:bg-yellow-200 dark:hover:bg-yellow-900/50 transition-colors"
                                        >
                                            Approve
                                        </button>
                                    )}
                                </td>
                                <td className="p-4 text-gray-600 dark:text-gray-400">{u.licenses?.length || 0}</td>
                                <td className="p-4 text-right">
                                    <button
                                        onClick={() => setSelectedUser(selectedUser?.id === u.id ? null : u)}
                                        className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-semibold text-sm transition-colors"
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
                <div className="bg-white dark:bg-gray-800 p-6 rounded shadow-sm border border-blue-200 dark:border-blue-900 animate-fade-in transition-colors">
                    <div className="flex justify-between items-center mb-4">
                        <h4 className="font-bold text-lg text-gray-800 dark:text-gray-200">
                            Manage {selectedUser.first_name} {selectedUser.last_name}
                        </h4>
                        <button onClick={() => setSelectedUser(null)} className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors">
                            <i className="fas fa-times"></i>
                        </button>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* Licenses Section */}
                        <div>
                            <h5 className="font-semibold text-gray-700 dark:text-gray-300 mb-2">Tool Licenses</h5>
                            <div className="grid grid-cols-1 gap-2 max-h-60 overflow-y-auto pr-2 custom-scroll">
                                {tools.map(tool => {
                                    const hasLicense = selectedUser.licenses?.includes(tool.id);
                                    return (
                                        <div key={tool.id} className={`p-2 rounded border flex items-center justify-between cursor-pointer transition-colors text-sm ${hasLicense ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800' : 'bg-gray-50 dark:bg-gray-700 border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600'}`}
                                            onClick={() => handleLicenseToggle(selectedUser.id, tool.id)}
                                        >
                                            <span className="font-medium text-gray-700 dark:text-gray-200">{tool.name}</span>
                                            {hasLicense ? <i className="fas fa-check-circle text-green-600 dark:text-green-400"></i> : <i className="far fa-circle text-gray-400 dark:text-gray-500"></i>}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Projects Section */}
                        <div>
                            <h5 className="font-semibold text-gray-700 dark:text-gray-300 mb-2">Assigned Projects</h5>
                            <div className="flex gap-2 mb-2">
                                <input
                                    type="text"
                                    placeholder="New Project Name"
                                    className="flex-1 border dark:border-gray-600 rounded px-2 py-1 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            const val = e.target.value.trim();
                                            if (val) {
                                                handleProjectAdd(selectedUser.id, val);
                                                e.target.value = '';
                                            }
                                        }
                                    }}
                                    id="new-project-input"
                                />
                                <button
                                    onClick={() => {
                                        const input = document.getElementById('new-project-input');
                                        const val = input.value.trim();
                                        if (val) {
                                            handleProjectAdd(selectedUser.id, val);
                                            input.value = '';
                                        }
                                    }}
                                    className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded text-sm transition-colors"
                                >
                                    Add
                                </button>
                            </div>
                            <div className="space-y-2 max-h-60 overflow-y-auto pr-2 custom-scroll">
                                {(!selectedUser.projects || selectedUser.projects.length === 0) && (
                                    <div className="text-gray-400 dark:text-gray-500 text-sm italic">No projects assigned.</div>
                                )}
                                {selectedUser.projects?.map((proj, idx) => (
                                    <div key={idx} className="flex justify-between items-center bg-gray-50 dark:bg-gray-700 p-2 rounded border dark:border-gray-600 text-sm transition-colors">
                                        <span className="text-gray-700 dark:text-gray-200">{proj}</span>
                                        <button
                                            onClick={() => handleProjectRemove(selectedUser.id, proj)}
                                            className="text-red-500 hover:text-red-700"
                                        >
                                            <i className="fas fa-trash-alt"></i>
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default UserManagement;
