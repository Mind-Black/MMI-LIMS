import React, { useState, useEffect, useCallback } from 'react';
import Icon from './Icon';
import { supabase } from '../supabaseClient';
import { useToast } from '../context/useToast';
import {
    TOOL_ACCESS_LEVELS,
    ACCESS_LEVEL_LABELS,
    getToolAccessLevel
} from '../utils/bookingUtils';

const countActiveLicenses = (licenses) => {
    if (!licenses) return 0;
    if (Array.isArray(licenses)) return licenses.length;
    if (typeof licenses === 'object') {
        return Object.values(licenses).filter(l => l && l !== TOOL_ACCESS_LEVELS.NONE).length;
    }
    return 0;
};

const getLicenseBreakdown = (licenses) => {
    if (!licenses) return '0 licenses';
    if (Array.isArray(licenses)) return `${licenses.length} (Level III)`;
    if (typeof licenses === 'object') {
        const counts = { level_1: 0, level_2: 0, level_3: 0 };
        for (const lvl of Object.values(licenses)) {
            if (counts[lvl] !== undefined) counts[lvl]++;
        }
        const total = counts.level_1 + counts.level_2 + counts.level_3;
        if (total === 0) return 'No licenses';
        const parts = [];
        if (counts.level_3 > 0) parts.push(`${counts.level_3} L-III`);
        if (counts.level_2 > 0) parts.push(`${counts.level_2} L-II`);
        if (counts.level_1 > 0) parts.push(`${counts.level_1} L-I`);
        return `${total} (${parts.join(', ')})`;
    }
    return '0 licenses';
};

const UserManagement = ({ tools = [], currentUser, onProfileUpdate }) => {
    const [allUsers, setAllUsers] = useState([]);
    const [selectedUser, setSelectedUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [approvalFilter, setApprovalFilter] = useState('all');
    const [updatingToolId, setUpdatingToolId] = useState(null);
    const { showToast } = useToast();

    // Fetch All Users (Directory query selects non-sensitive columns)
    const fetchUsers = useCallback(async () => {
        try {
            setLoading(true);
            const users = [];
            for (let offset = 0; ;) {
                const { data, error } = await supabase.from('profiles')
                    .select('id, first_name, last_name, email, phone, job_title, access_level, is_approved, licenses, projects')
                    .order('last_name').order('id').range(offset, offset + 499);
                if (error) throw error;
                if (!data?.length) break;
                users.push(...data);
                offset += data.length;
            }
            setAllUsers(users);
        } catch (error) {
            console.error('Error fetching users:', error);
            showToast('Failed to fetch users: ' + error.message, 'error');
        } finally {
            setLoading(false);
        }
    }, [showToast]);

    useEffect(() => {
        fetchUsers();
    }, [fetchUsers]);

    // Update access level for a tool (Level I, Level II, Level III, or None)
    const handleSetAccessLevel = async (userId, toolId, newLevel) => {
        const userToUpdate = allUsers.find(u => u.id === userId);
        if (!userToUpdate) return;

        setUpdatingToolId(toolId);
        try {
            // Normalize existing licenses to object format
            let baseLicenses = {};
            if (userToUpdate.licenses && typeof userToUpdate.licenses === 'object' && !Array.isArray(userToUpdate.licenses)) {
                baseLicenses = { ...userToUpdate.licenses };
            } else if (Array.isArray(userToUpdate.licenses)) {
                for (const id of userToUpdate.licenses) {
                    baseLicenses[id] = TOOL_ACCESS_LEVELS.LEVEL_3;
                }
            }

            if (newLevel === TOOL_ACCESS_LEVELS.NONE) {
                delete baseLicenses[toolId];
                delete baseLicenses[String(toolId)];
            } else {
                baseLicenses[toolId] = newLevel;
            }

            // Try RPC first for authorization check (Admin or Tool Responsible)
            const { data: rpcData, error: rpcError } = await supabase.rpc('set_user_tool_license', {
                p_user_id: userId,
                p_tool_id: toolId,
                p_level: newLevel
            });

            let finalLicenses = baseLicenses;

            if (rpcError) {
                // Fallback to direct profiles table update if RPC not applied yet
                const { data: updateData, error: updateError } = await supabase
                    .from('profiles')
                    .update({ licenses: baseLicenses })
                    .eq('id', userId)
                    .select('id, licenses');

                if (updateError) throw updateError;
                if (!updateData || updateData.length === 0) {
                    throw new Error('Update failed or permission denied (0 rows affected)');
                }
                finalLicenses = updateData[0].licenses;
            } else if (rpcData?.licenses) {
                finalLicenses = rpcData.licenses;
            }

            setAllUsers(prev => prev.map(u => u.id === userId ? { ...u, licenses: finalLicenses } : u));
            if (selectedUser?.id === userId) {
                setSelectedUser(prev => prev ? { ...prev, licenses: finalLicenses } : null);
            }
            if (currentUser && currentUser.id === userId && onProfileUpdate) {
                onProfileUpdate();
            }

            const levelLabel = ACCESS_LEVEL_LABELS[newLevel] || 'No License';
            showToast(`Access updated to "${levelLabel}"`, 'success');
        } catch (error) {
            console.error('Error updating access level:', error);
            showToast('Failed to update access level: ' + error.message, 'error');
        } finally {
            setUpdatingToolId(null);
        }
    };

    const handleApproveUser = async (userId) => {
        try {
            const { data, error } = await supabase
                .from('profiles')
                .update({ is_approved: true })
                .eq('id', userId)
                .select('id, is_approved');

            if (error) throw error;
            if (!data || data.length === 0) {
                throw new Error('User approval could not be applied');
            }

            setAllUsers(prev => prev.map(u => u.id === userId ? { ...u, is_approved: true } : u));
            showToast('User approved successfully.', 'success');
        } catch (error) {
            console.error('Error approving user:', error);
            showToast('Failed to approve user: ' + error.message, 'error');
        }
    };

    const handleProjectAdd = async (userId, projectName) => {
        const userToUpdate = allUsers.find(u => u.id === userId);
        if (!userToUpdate) return;

        const currentProjects = Array.isArray(userToUpdate.projects) ? userToUpdate.projects : [];
        if (currentProjects.includes(projectName)) {
            showToast('Project already assigned.', 'error');
            return;
        }

        const newProjects = [...currentProjects, projectName];

        try {
            const { data, error } = await supabase
                .from('profiles')
                .update({ projects: newProjects })
                .eq('id', userId)
                .select('id, projects');

            if (error) throw error;
            if (!data || data.length === 0) {
                throw new Error('Failed to add project');
            }

            setAllUsers(prev => prev.map(u => u.id === userId ? { ...u, projects: newProjects } : u));
            if (selectedUser?.id === userId) {
                setSelectedUser(prev => prev ? { ...prev, projects: newProjects } : null);
            }
            if (currentUser && currentUser.id === userId && onProfileUpdate) {
                onProfileUpdate();
            }
            showToast('Project added successfully.', 'success');
        } catch (error) {
            console.error('Error adding project:', error);
            showToast('Failed to add project: ' + error.message, 'error');
        }
    };

    const handleProjectRemove = async (userId, projectName) => {
        const userToUpdate = allUsers.find(u => u.id === userId);
        if (!userToUpdate) return;

        const newProjects = (Array.isArray(userToUpdate.projects) ? userToUpdate.projects : []).filter(p => p !== projectName);

        try {
            const { data, error } = await supabase
                .from('profiles')
                .update({ projects: newProjects })
                .eq('id', userId)
                .select('id, projects');

            if (error) throw error;
            if (!data || data.length === 0) {
                throw new Error('Failed to remove project');
            }

            setAllUsers(prev => prev.map(u => u.id === userId ? { ...u, projects: newProjects } : u));
            if (selectedUser?.id === userId) {
                setSelectedUser(prev => prev ? { ...prev, projects: newProjects } : null);
            }
            if (currentUser && currentUser.id === userId && onProfileUpdate) {
                onProfileUpdate();
            }
            showToast('Project removed successfully.', 'success');
        } catch (error) {
            console.error('Error removing project:', error);
            showToast('Failed to remove project: ' + error.message, 'error');
        }
    };

    const filteredUsers = allUsers.filter(user => {
        const terms = `${user.first_name || ''} ${user.last_name || ''} ${user.job_title || ''} ${user.email || ''}`.toLowerCase();
        return terms.includes(search.toLowerCase()) && (approvalFilter === 'all' || (approvalFilter === 'approved') === Boolean(user.is_approved));
    });

    return (
        <div className="space-y-6">
            <h3 className="font-bold text-gray-800 dark:text-gray-200 transition-colors">User Management</h3>
            <div className="card p-4 flex flex-col sm:flex-row gap-3">
                <label className="flex-1 text-sm text-gray-700 dark:text-gray-200">Search users
                    <input
                        type="search"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        className="input-field mt-1"
                        placeholder="Search name, job title, or email..."
                    />
                </label>
                <label className="text-sm text-gray-700 dark:text-gray-200">Approval status
                    <select
                        value={approvalFilter}
                        onChange={e => setApprovalFilter(e.target.value)}
                        className="select-input block mt-1"
                    >
                        <option value="all">All</option>
                        <option value="approved">Approved</option>
                        <option value="pending">Pending</option>
                    </select>
                </label>
            </div>

            <div className="card overflow-hidden">
                {/* Mobile User Cards */}
                <div className="lg:hidden divide-y dark:divide-gray-700">
                    {filteredUsers.map(u => (
                        <div key={u.id} className="p-4 space-y-2 text-sm text-gray-700 dark:text-gray-200">
                            <div className="font-bold break-words">{u.first_name} {u.last_name}</div>
                            {u.email && <div className="text-xs text-gray-500">{u.email}</div>}
                            <div>{u.job_title} · {u.access_level} · {u.is_approved ? 'Approved' : 'Pending'}</div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">
                                Equipment: {getLicenseBreakdown(u.licenses)}
                            </div>
                            <div className="flex gap-2 pt-1">
                                {!u.is_approved && (
                                    <button onClick={() => handleApproveUser(u.id)} className="btn btn-primary btn-sm">
                                        Approve
                                    </button>
                                )}
                                <button
                                    onClick={() => setSelectedUser(selectedUser?.id === u.id ? null : u)}
                                    className="btn btn-secondary btn-sm"
                                >
                                    {selectedUser?.id === u.id ? 'Close' : 'Manage Access'}
                                </button>
                            </div>
                        </div>
                    ))}
                </div>

                {/* Desktop Users Table */}
                <table className="hidden lg:table w-full text-left border-collapse">
                    <thead className="bg-gray-50 dark:bg-gray-900 border-b dark:border-gray-700 transition-colors">
                        <tr>
                            <th className="p-4 font-semibold text-gray-600 dark:text-gray-300">Name</th>
                            <th className="p-4 font-semibold text-gray-600 dark:text-gray-300">Job Title</th>
                            <th className="p-4 font-semibold text-gray-600 dark:text-gray-300">Role</th>
                            <th className="p-4 font-semibold text-gray-600 dark:text-gray-300">Status</th>
                            <th className="p-4 font-semibold text-gray-600 dark:text-gray-300">Equipment Access Levels</th>
                            <th className="p-4 font-semibold text-gray-600 dark:text-gray-300 text-right">Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredUsers.map(u => (
                            <tr key={u.id} className="border-b dark:border-gray-700 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                                <td className="p-4">
                                    <div className="font-bold text-gray-800 dark:text-gray-200">{u.first_name} {u.last_name}</div>
                                    {u.email && <div className="text-xs text-gray-400">{u.email}</div>}
                                </td>
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
                                <td className="p-4 text-xs text-gray-700 dark:text-gray-300">
                                    {getLicenseBreakdown(u.licenses)}
                                </td>
                                <td className="p-4 text-right">
                                    <button
                                        onClick={() => setSelectedUser(selectedUser?.id === u.id ? null : u)}
                                        className="btn btn-sm btn-ghost"
                                    >
                                        {selectedUser?.id === u.id ? 'Close' : 'Manage Access'}
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                {filteredUsers.length === 0 && (
                    <div className="p-8 text-center text-gray-500 dark:text-gray-400">
                        {loading ? 'Loading users...' : allUsers.length ? 'No users match these filters.' : 'No users found.'}
                    </div>
                )}
            </div>

            {/* Selected User Management Drawer */}
            {selectedUser && (
                <div className="card p-6 animate-fade-in space-y-6">
                    <div className="flex justify-between items-center border-b dark:border-gray-700 pb-3">
                        <div>
                            <h4 className="font-bold text-lg text-gray-800 dark:text-gray-200">
                                Manage Access: {selectedUser.first_name} {selectedUser.last_name}
                            </h4>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                                {selectedUser.job_title} &bull; {selectedUser.email || 'No email registered'} &bull; Role: {selectedUser.access_level}
                            </p>
                        </div>
                        <button
                            onClick={() => setSelectedUser(null)}
                            aria-label="Close user details"
                            className="btn btn-ghost btn-sm"
                        >
                            <Icon className="fas fa-times" />
                        </button>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* Equipment Access Levels Section */}
                        <div>
                            <div className="flex items-center justify-between mb-2">
                                <h5 className="font-semibold text-gray-700 dark:text-gray-300">
                                    Equipment Access Levels
                                </h5>
                                <span className="text-xs text-gray-500">
                                    {countActiveLicenses(selectedUser.licenses)} active
                                </span>
                            </div>

                            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                                Set operator authorization tier: <strong>Level I</strong> (Training in progress), <strong>Level II</strong> (Supervised / Booking requires confirmation), or <strong>Level III</strong> (Independent operator).
                            </p>

                            <div className="space-y-2.5 max-h-96 overflow-y-auto pr-2 custom-scroll">
                                {tools.map(tool => {
                                    const currentLevel = getToolAccessLevel(selectedUser, tool.id);
                                    const isBusy = updatingToolId === tool.id;

                                    return (
                                        <div
                                            key={tool.id}
                                            className="p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/40 space-y-2"
                                        >
                                            <div className="flex justify-between items-start">
                                                <div>
                                                    <span className="font-medium text-sm text-gray-800 dark:text-gray-200">
                                                        {tool.name}
                                                    </span>
                                                    <span className="text-xs text-gray-500 ml-2">
                                                        ({tool.category})
                                                    </span>
                                                </div>
                                                {!tool.license_req && (
                                                    <span className="text-[11px] font-semibold text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 px-2 py-0.5 rounded">
                                                        Open Access
                                                    </span>
                                                )}
                                            </div>

                                            {/* 4-Option Segmented Control */}
                                            <div className="flex flex-wrap gap-1 bg-white dark:bg-gray-900 p-1 rounded-md border dark:border-gray-700 text-xs">
                                                <button
                                                    type="button"
                                                    disabled={isBusy}
                                                    onClick={() => handleSetAccessLevel(selectedUser.id, tool.id, TOOL_ACCESS_LEVELS.NONE)}
                                                    className={`flex-1 py-1 px-2 rounded font-medium transition ${currentLevel === TOOL_ACCESS_LEVELS.NONE ? 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100 font-bold shadow-xs' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'}`}
                                                    title="No access granted"
                                                >
                                                    None
                                                </button>
                                                <button
                                                    type="button"
                                                    disabled={isBusy}
                                                    onClick={() => handleSetAccessLevel(selectedUser.id, tool.id, TOOL_ACCESS_LEVELS.LEVEL_1)}
                                                    className={`flex-1 py-1 px-2 rounded font-medium transition flex items-center justify-center gap-1 ${currentLevel === TOOL_ACCESS_LEVELS.LEVEL_1 ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200 font-bold shadow-xs' : 'text-gray-600 dark:text-gray-400 hover:bg-amber-50 dark:hover:bg-amber-900/20'}`}
                                                    title="Level I: Undergoing training (No booking permitted)"
                                                >
                                                    <Icon className="fas fa-user-graduate text-[10px]" />
                                                    Level I
                                                </button>
                                                <button
                                                    type="button"
                                                    disabled={isBusy}
                                                    onClick={() => handleSetAccessLevel(selectedUser.id, tool.id, TOOL_ACCESS_LEVELS.LEVEL_2)}
                                                    className={`flex-1 py-1 px-2 rounded font-medium transition flex items-center justify-center gap-1 ${currentLevel === TOOL_ACCESS_LEVELS.LEVEL_2 ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-200 font-bold shadow-xs' : 'text-gray-600 dark:text-gray-400 hover:bg-blue-50 dark:hover:bg-blue-900/20'}`}
                                                    title="Level II: Supervised (Booking holds slot tentatively, requires Tool Responsible confirmation)"
                                                >
                                                    <Icon className="fas fa-user-check text-[10px]" />
                                                    Level II
                                                </button>
                                                <button
                                                    type="button"
                                                    disabled={isBusy}
                                                    onClick={() => handleSetAccessLevel(selectedUser.id, tool.id, TOOL_ACCESS_LEVELS.LEVEL_3)}
                                                    className={`flex-1 py-1 px-2 rounded font-medium transition flex items-center justify-center gap-1 ${currentLevel === TOOL_ACCESS_LEVELS.LEVEL_3 ? 'bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-200 font-bold shadow-xs' : 'text-gray-600 dark:text-gray-400 hover:bg-green-50 dark:hover:bg-green-900/20'}`}
                                                    title="Level III: Independent operator (Direct booking permitted)"
                                                >
                                                    <Icon className="fas fa-award text-[10px]" />
                                                    Level III
                                                </button>
                                            </div>

                                            {/* Helper Description for current level */}
                                            <div className="text-[11px] text-gray-500 dark:text-gray-400 px-1">
                                                {currentLevel === TOOL_ACCESS_LEVELS.LEVEL_1 && (
                                                    <span className="text-amber-700 dark:text-amber-300 flex items-center gap-1">
                                                        <Icon className="fas fa-info-circle text-[10px]" />
                                                        Level I: User is registered for training. Equipment booking is restricted.
                                                    </span>
                                                )}
                                                {currentLevel === TOOL_ACCESS_LEVELS.LEVEL_2 && (
                                                    <span className="text-blue-700 dark:text-blue-300 flex items-center gap-1">
                                                        <Icon className="fas fa-info-circle text-[10px]" />
                                                        Level II: User can book; reservations are held tentatively until confirmed by a Tool Responsible.
                                                    </span>
                                                )}
                                                {currentLevel === TOOL_ACCESS_LEVELS.LEVEL_3 && (
                                                    <span className="text-green-700 dark:text-green-300 flex items-center gap-1">
                                                        <Icon className="fas fa-check-circle text-[10px]" />
                                                        Level III: Fully certified for independent reservations.
                                                    </span>
                                                )}
                                            </div>
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
                                    aria-label="New project name"
                                    type="text"
                                    placeholder="New Project Name"
                                    className="input-field py-1 text-sm flex-1"
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
                                    className="btn btn-primary btn-sm"
                                    onClick={() => {
                                        const input = document.getElementById('new-project-input');
                                        if (input && input.value.trim()) {
                                            handleProjectAdd(selectedUser.id, input.value.trim());
                                            input.value = '';
                                        }
                                    }}
                                >
                                    Add
                                </button>
                            </div>
                            <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto">
                                {selectedUser.projects?.map((proj, idx) => (
                                    <span key={idx} className="bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 px-2 py-1 rounded text-xs flex items-center gap-1">
                                        {proj}
                                        <button
                                            type="button"
                                            aria-label={`Remove project ${proj}`}
                                            className="fas fa-times cursor-pointer hover:text-red-500 ml-1 text-xs"
                                            onClick={() => handleProjectRemove(selectedUser.id, proj)}
                                        ></button>
                                    </span>
                                ))}
                                {(!selectedUser.projects || selectedUser.projects.length === 0) && (
                                    <span className="text-gray-400 text-xs italic">No projects assigned</span>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default UserManagement;
