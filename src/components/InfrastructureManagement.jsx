import React, { useState, useMemo, useEffect } from 'react';
import Icon from './Icon';
import StatusBadge from './StatusBadge';
import RateCategoryBadge from './RateCategoryBadge';
import RatePricingModal from './RatePricingModal';
import { supabase } from '../supabaseClient';
import { useToast } from '../context/useToast';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { downloadInfrastructureCsvTemplate } from '../utils/csvHelper';

const toolImages = import.meta.glob('../assets/tool_thumbnails/*.{jpg,webp,avif}', { eager: true, import: 'default' });
const getToolImage = (id, width = 256, extension = 'jpg') =>
    toolImages[`../assets/tool_thumbnails/${id}-${width}.${extension}`] || null;

const InfrastructureManagement = ({
    tools = [],
    onStatusChange,
    onToolsChange,
    onOpenAddModal
}) => {
    const [searchQuery, setSearchQuery] = useState('');
    const [filterCategory, setFilterCategory] = useState('All');
    const [filterRateCategory, setFilterRateCategory] = useState('All');
    const [filterStatus, setFilterStatus] = useState('All');
    const [isPricingModalOpen, setIsPricingModalOpen] = useState(false);
    const [isSyncGuideOpen, setIsSyncGuideOpen] = useState(false);
    const [syncGuideToolId, setSyncGuideToolId] = useState('');
    const [editingTool, setEditingTool] = useState(null);
    const [isSavingEdit, setIsSavingEdit] = useState(false);
    const [deletingToolId, setDeletingToolId] = useState(null);
    const [availableUsers, setAvailableUsers] = useState([]);
    const { showToast } = useToast();
    const syncGuideDialogRef = useDialogFocus(isSyncGuideOpen, () => setIsSyncGuideOpen(false));

    // Fetch users for Tool Responsible assignment dropdown
    useEffect(() => {
        const fetchUsers = async () => {
            try {
                const { data, error } = await supabase
                    .from('profiles')
                    .select('id, first_name, last_name, email, phone, job_title, access_level')
                    .order('last_name');
                if (!error && data) {
                    setAvailableUsers(data);
                }
            } catch (err) {
                console.error('Error fetching users for tool responsible:', err);
            }
        };
        fetchUsers();
    }, []);

    // Categories
    const categories = useMemo(() => {
        const cats = new Set(tools.map(t => t.category).filter(Boolean));
        return ['All', ...Array.from(cats).sort()];
    }, [tools]);

    // Statistics
    const stats = useMemo(() => {
        const total = tools.length;
        const up = tools.filter(t => t.status === 'up').length;
        const service = tools.filter(t => t.status === 'service').length;
        const down = tools.filter(t => t.status === 'down').length;
        const licenseReq = tools.filter(t => t.license_req).length;
        return { total, up, service, down, licenseReq, openAccess: total - licenseReq };
    }, [tools]);

    // Filtered tools
    const filteredTools = useMemo(() => {
        return tools.filter(tool => {
            const matchesCat = filterCategory === 'All' || tool.category === filterCategory;
            const matchesStatus = filterStatus === 'All' || tool.status === filterStatus;
            const matchesRate = filterRateCategory === 'All' || (tool.rate_category || 'A') === filterRateCategory;
            const matchesQuery = !searchQuery.trim() ||
                tool.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                String(tool.id).includes(searchQuery) ||
                (tool.location && tool.location.toLowerCase().includes(searchQuery.toLowerCase())) ||
                (tool.description && tool.description.toLowerCase().includes(searchQuery.toLowerCase()));
            return matchesCat && matchesStatus && matchesRate && matchesQuery;
        });
    }, [tools, filterCategory, filterRateCategory, filterStatus, searchQuery]);

    // Save edited metadata
    const handleSaveEdit = async (e) => {
        e.preventDefault();
        if (!editingTool) return;

        const syncEnabled = Boolean(editingTool.ms_bookings_sync_enabled);
        const bookingsEmail = editingTool.ms_bookings_email?.trim() || null;
        if (syncEnabled && !bookingsEmail) {
            showToast('Microsoft Bookings Page SMTP Address is required when sync is enabled.', 'error');
            return;
        }

        setIsSavingEdit(true);
        const updates = {
            name: editingTool.name.trim(),
            category: editingTool.category.trim(),
            rate_category: editingTool.rate_category || 'A',
            location: editingTool.location?.trim() || null,
            license_req: Boolean(editingTool.license_req),
            description: editingTool.description?.trim() || null,
            image_url: editingTool.image_url?.trim() || null,
            primary_responsible_id: editingTool.primary_responsible_id || null,
            secondary_responsible_id: editingTool.secondary_responsible_id || null,
            ms_bookings_sync_enabled: syncEnabled,
            ms_bookings_email: bookingsEmail,
            ms_bookings_service_id: editingTool.ms_bookings_service_id?.trim() || null
        };

        try {
            let { data, error } = await supabase
                .from('tools')
                .update(updates)
                .eq('id', editingTool.id)
                .select('id, name, category, rate_category, status, location, license_req, description, image_url, primary_responsible_id, secondary_responsible_id, ms_bookings_email, ms_bookings_service_id, ms_bookings_sync_enabled')
                .single();

            // Fallback if newly added columns not yet applied on DB
            if (error && error.message) {
                const legacyUpdates = { ...updates };
                delete legacyUpdates.ms_bookings_sync_enabled;
                delete legacyUpdates.ms_bookings_email;
                delete legacyUpdates.ms_bookings_service_id;
                delete legacyUpdates.primary_responsible_id;
                delete legacyUpdates.secondary_responsible_id;
                delete legacyUpdates.image_url;
                delete legacyUpdates.rate_category;
                const retry = await supabase
                    .from('tools')
                    .update(legacyUpdates)
                    .eq('id', editingTool.id)
                    .select('id, name, category, status, location, license_req, description')
                    .single();
                data = retry.data;
                error = retry.error;
            }

            if (error) throw error;

            // Attach rich responsible profile references
            const primaryUser = availableUsers.find(u => u.id === updates.primary_responsible_id) || null;
            const secondaryUser = availableUsers.find(u => u.id === updates.secondary_responsible_id) || null;

            const enrichedTool = {
                ...data,
                primary_responsible: primaryUser,
                secondary_responsible: secondaryUser
            };

            showToast(`Updated "${data.name}" successfully!`, 'success');
            if (onToolsChange) {
                onToolsChange(prev => prev.map(t => t.id === data.id ? { ...t, ...enrichedTool } : t));
            }
            setEditingTool(null);
        } catch (err) {
            console.error('Error updating tool metadata:', err);
            showToast('Failed to update equipment: ' + (err.message || 'Unknown error'), 'error');
        } finally {
            setIsSavingEdit(false);
        }
    };

    // Decommission / Delete tool
    const handleDeleteTool = async (tool) => {
        const confirm = window.confirm(`Are you sure you want to remove "${tool.name}" (ID ${tool.id})? Active and future reservations for this tool will be affected.`);
        if (!confirm) return;

        setDeletingToolId(tool.id);
        try {
            const { error } = await supabase
                .from('tools')
                .delete()
                .eq('id', tool.id);

            if (error) throw error;

            showToast(`Equipment "${tool.name}" removed successfully.`, 'success');
            if (onToolsChange) {
                onToolsChange(prev => prev.filter(t => t.id !== tool.id));
            }
        } catch (err) {
            console.error('Error deleting equipment:', err);
            showToast('Failed to remove equipment: ' + (err.message || 'Unknown error'), 'error');
        } finally {
            setDeletingToolId(null);
        }
    };

    const syncedTools = useMemo(
        () => tools.filter(t => t.ms_bookings_sync_enabled && t.ms_bookings_email),
        [tools]
    );

    const openSyncGuide = (tool = null) => {
        setSyncGuideToolId(tool?.id ? String(tool.id) : (syncedTools[0]?.id ? String(syncedTools[0].id) : ''));
        setIsSyncGuideOpen(true);
    };

    const copySnippet = async (label, value) => {
        try {
            await navigator.clipboard.writeText(value);
            showToast(`${label} copied to clipboard.`, 'success');
        } catch {
            showToast(`Could not copy automatically. Please select and copy ${label} manually.`, 'info');
        }
    };

    const supabaseBaseUrl = (import.meta.env.VITE_SUPABASE_URL || 'https://YOUR-PROJECT.supabase.co').replace(/\/+$/, '');
    const syncEndpointUrl = `${supabaseBaseUrl}/functions/v1/ms-bookings-sync`;
    const activeGuideTool = syncedTools.find(t => String(t.id) === String(syncGuideToolId)) || syncedTools[0] || null;
    const guideBookingsEmail = activeGuideTool?.ms_bookings_email || 'RaithSystem@your-org.edu';

    return (
        <div className="space-y-6">
            {/* Header & Stats */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
                        <Icon className="fas fa-server text-blue-600 dark:text-blue-400" />
                        Infrastructure Management
                    </h2>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                        Configure laboratory equipment, assign designated Tool Responsibles, and manage operational statuses.
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <button
                        type="button"
                        onClick={() => openSyncGuide()}
                        className="btn btn-secondary btn-sm flex items-center gap-1.5"
                        title="Configure two-way Microsoft Bookings sync via Power Automate"
                    >
                        <Icon className="fas fa-sync-alt text-indigo-600 dark:text-indigo-400" />
                        MS Bookings Sync
                    </button>
                    <button
                        type="button"
                        onClick={() => setIsPricingModalOpen(true)}
                        className="btn btn-secondary btn-sm flex items-center gap-1.5"
                        title="View official equipment rate categories and access modes"
                    >
                        <Icon className="fas fa-tags text-emerald-600 dark:text-emerald-400" />
                        Rate Guide
                    </button>
                    <button
                        type="button"
                        onClick={() => downloadInfrastructureCsvTemplate()}
                        className="btn btn-secondary btn-sm flex items-center gap-1.5"
                        title="Download CSV Template"
                    >
                        <Icon className="fas fa-download" />
                        CSV Template
                    </button>
                    <button
                        type="button"
                        onClick={() => onOpenAddModal('bulk')}
                        className="btn btn-secondary btn-sm flex items-center gap-1.5"
                    >
                        <Icon className="fas fa-file-csv" />
                        Bulk Import CSV
                    </button>
                    <button
                        type="button"
                        onClick={() => onOpenAddModal('single')}
                        className="btn btn-primary btn-sm flex items-center gap-1.5"
                    >
                        <Icon className="fas fa-plus" />
                        Add Equipment
                    </button>
                </div>
            </div>

            {/* Metric KPI Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <div className="card p-3 text-center">
                    <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">Total Equipment</span>
                    <span className="text-xl font-bold text-gray-800 dark:text-gray-100 block mt-1">{stats.total}</span>
                </div>
                <div className="card p-3 text-center border-l-4 border-l-green-500">
                    <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">Operational (Up)</span>
                    <span className="text-xl font-bold text-green-600 dark:text-green-400 block mt-1">{stats.up}</span>
                </div>
                <div className="card p-3 text-center border-l-4 border-l-yellow-500">
                    <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">In Service</span>
                    <span className="text-xl font-bold text-yellow-600 dark:text-yellow-400 block mt-1">{stats.service}</span>
                </div>
                <div className="card p-3 text-center border-l-4 border-l-red-500">
                    <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">Offline (Down)</span>
                    <span className="text-xl font-bold text-red-600 dark:text-red-400 block mt-1">{stats.down}</span>
                </div>
                <div className="card p-3 text-center">
                    <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">License Required</span>
                    <span className="text-xl font-bold text-blue-600 dark:text-blue-400 block mt-1">{stats.licenseReq}</span>
                </div>
                <div className="card p-3 text-center">
                    <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">Open Access</span>
                    <span className="text-xl font-bold text-purple-600 dark:text-purple-400 block mt-1">{stats.openAccess}</span>
                </div>
            </div>

            {/* Filter and Search Bar */}
            <div className="card p-4 flex flex-col md:flex-row gap-3">
                <div className="flex-1">
                    <input
                        type="text"
                        placeholder="Search equipment by name, ID, location, or notes..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="input-field text-sm"
                        aria-label="Search equipment"
                    />
                </div>
                <div className="flex gap-2">
                    <select
                        value={filterCategory}
                        onChange={(e) => setFilterCategory(e.target.value)}
                        className="select-input text-sm"
                        aria-label="Filter by category"
                    >
                        {categories.map(cat => (
                            <option key={cat} value={cat}>{cat === 'All' ? 'All Categories' : cat}</option>
                        ))}
                    </select>
                    <select
                        value={filterRateCategory}
                        onChange={(e) => setFilterRateCategory(e.target.value)}
                        className="select-input text-sm"
                        aria-label="Filter by rate category"
                    >
                        <option value="All">All Rates (A-D)</option>
                        <option value="A">Rate A</option>
                        <option value="B">Rate B</option>
                        <option value="C">Rate C</option>
                        <option value="D">Rate D</option>
                    </select>
                    <select
                        value={filterStatus}
                        onChange={(e) => setFilterStatus(e.target.value)}
                        className="select-input text-sm"
                        aria-label="Filter by status"
                    >
                        <option value="All">All Statuses</option>
                        <option value="up">Available (Up)</option>
                        <option value="service">In Service</option>
                        <option value="down">Unavailable (Down)</option>
                    </select>
                </div>
            </div>

            {/* Equipment Table */}
            <div className="card p-0 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-sm">
                        <thead className="bg-gray-50 dark:bg-gray-900 border-b dark:border-gray-700">
                            <tr>
                                <th className="p-3 text-xs font-semibold text-gray-600 dark:text-gray-300">ID</th>
                                <th className="p-3 text-xs font-semibold text-gray-600 dark:text-gray-300">Equipment</th>
                                <th className="p-3 text-xs font-semibold text-gray-600 dark:text-gray-300">Category & Rate</th>
                                <th className="p-3 text-xs font-semibold text-gray-600 dark:text-gray-300">Tool Responsible</th>
                                <th className="p-3 text-xs font-semibold text-gray-600 dark:text-gray-300">Location</th>
                                <th className="p-3 text-xs font-semibold text-gray-600 dark:text-gray-300">Operational Status</th>
                                <th className="p-3 text-xs font-semibold text-gray-600 dark:text-gray-300">License</th>
                                <th className="p-3 text-xs font-semibold text-gray-600 dark:text-gray-300 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y dark:divide-gray-700">
                            {filteredTools.map(tool => {
                                const staticImg = getToolImage(tool.id);
                                const imgSrc = tool.image_url || staticImg;
                                const resp = tool.primary_responsible;
                                const respName = resp ? `${resp.first_name || ''} ${resp.last_name || ''}`.trim() : 'Lab Administrator';

                                return (
                                    <tr key={tool.id} className="hover:bg-blue-50/20 dark:hover:bg-blue-900/10 transition">
                                        <td className="p-3 font-mono text-gray-500 dark:text-gray-400 text-xs">
                                            {tool.id}
                                        </td>
                                        <td className="p-3">
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 rounded bg-gray-100 dark:bg-gray-800 border dark:border-gray-700 flex items-center justify-center shrink-0 overflow-hidden">
                                                    {imgSrc ? (
                                                        <img src={imgSrc} alt={tool.name} className="w-full h-full object-cover" loading="lazy" />
                                                    ) : (
                                                        <Icon className="fas fa-camera text-gray-400 text-sm" />
                                                    )}
                                                </div>
                                                <div>
                                                    <div className="font-bold text-gray-800 dark:text-gray-200 flex items-center gap-1.5 flex-wrap">
                                                        <span>{tool.name}</span>
                                                        {tool.ms_bookings_sync_enabled && tool.ms_bookings_email && (
                                                            <button
                                                                type="button"
                                                                onClick={() => openSyncGuide(tool)}
                                                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-700 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 cursor-pointer"
                                                                title={`Synced with Microsoft Bookings (${tool.ms_bookings_email})`}
                                                            >
                                                                <Icon className="fas fa-sync-alt text-[9px]" />
                                                                MS Bookings Sync
                                                            </button>
                                                        )}
                                                    </div>
                                                    {tool.description && (
                                                        <div className="text-xs text-gray-500 dark:text-gray-400 line-clamp-1 max-w-xs">
                                                            {tool.description}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </td>
                                        <td className="p-3">
                                            <div className="flex items-center gap-1.5 flex-wrap">
                                                <span className="bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded text-xs font-semibold">
                                                    {tool.category}
                                                </span>
                                                <RateCategoryBadge rate={tool.rate_category} />
                                            </div>
                                        </td>
                                        <td className="p-3 text-xs">
                                            <div className="font-semibold text-gray-800 dark:text-gray-200 flex items-center gap-1">
                                                <Icon className="fas fa-user-shield text-blue-600 dark:text-blue-400 text-[10px]" />
                                                <span>{respName}</span>
                                            </div>
                                            {resp?.email && (
                                                <div className="text-gray-500 dark:text-gray-400 text-[11px] truncate max-w-[150px]">
                                                    {resp.email}
                                                </div>
                                            )}
                                        </td>
                                        <td className="p-3 text-gray-700 dark:text-gray-300 text-xs">
                                            {tool.location || <span className="text-gray-400 italic">Unassigned</span>}
                                        </td>
                                        <td className="p-3">
                                            <div className="flex items-center gap-2">
                                                <StatusBadge status={tool.status} />
                                                <select
                                                    aria-label={`Status for ${tool.name}`}
                                                    value={tool.status}
                                                    onChange={(e) => onStatusChange(tool.id, e.target.value)}
                                                    className="select-input text-xs p-1"
                                                >
                                                    <option value="up">Up</option>
                                                    <option value="service">Service</option>
                                                    <option value="down">Down</option>
                                                </select>
                                            </div>
                                        </td>
                                        <td className="p-3">
                                            {tool.license_req ? (
                                                <span className="text-blue-700 dark:text-blue-400 font-medium text-xs flex items-center gap-1">
                                                    <Icon className="fas fa-check-circle" /> Required
                                                </span>
                                            ) : (
                                                <span className="text-green-600 dark:text-green-400 text-xs font-medium">
                                                    Open Access
                                                </span>
                                            )}
                                        </td>
                                        <td className="p-3 text-right">
                                            <div className="flex justify-end gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() => setEditingTool(tool)}
                                                    className="btn btn-secondary btn-sm p-1.5 text-xs"
                                                    title="Edit equipment metadata & Tool Responsibles"
                                                >
                                                    <Icon className="fas fa-edit" />
                                                </button>
                                                <button
                                                    type="button"
                                                    disabled={deletingToolId === tool.id}
                                                    onClick={() => handleDeleteTool(tool)}
                                                    className="btn btn-secondary btn-sm p-1.5 text-xs text-red-600 hover:text-red-700"
                                                    title="Delete / Decommission equipment"
                                                >
                                                    <Icon className="fas fa-trash" />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                    {filteredTools.length === 0 && (
                        <div className="p-8 text-center text-gray-500 dark:text-gray-400">
                            No laboratory infrastructure matches the selected criteria.
                        </div>
                    )}
                </div>
            </div>

            {/* Edit Metadata Modal */}
            {editingTool && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-lg w-full p-6 space-y-4 border dark:border-gray-700 max-h-[90vh] overflow-y-auto">
                        <div className="flex justify-between items-center border-b dark:border-gray-700 pb-2">
                            <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                                <Icon className="fas fa-edit text-blue-600 dark:text-blue-400" />
                                Edit Equipment (ID {editingTool.id})
                            </h3>
                            <button
                                type="button"
                                onClick={() => setEditingTool(null)}
                                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                            >
                                <Icon className="fas fa-times text-lg" />
                            </button>
                        </div>
                        <form onSubmit={handleSaveEdit} className="space-y-4">
                            <div>
                                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase mb-1">
                                    Equipment Name
                                </label>
                                <input
                                    type="text"
                                    required
                                    value={editingTool.name}
                                    onChange={(e) => setEditingTool({ ...editingTool, name: e.target.value })}
                                    className="input-field text-sm"
                                />
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                <div>
                                    <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase mb-1">
                                        Category
                                    </label>
                                    <input
                                        type="text"
                                        required
                                        value={editingTool.category}
                                        onChange={(e) => setEditingTool({ ...editingTool, category: e.target.value })}
                                        className="input-field text-sm"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase mb-1 flex items-center justify-between">
                                        <span className="flex items-center gap-1.5">
                                            <span>Rate</span>
                                            <button
                                                type="button"
                                                onClick={() => setIsPricingModalOpen(true)}
                                                className="text-[10px] text-blue-600 dark:text-blue-400 hover:underline cursor-pointer normal-case"
                                            >
                                                (guide)
                                            </button>
                                        </span>
                                        <RateCategoryBadge rate={editingTool.rate_category || 'A'} size="xs" />
                                    </label>
                                    <select
                                        value={editingTool.rate_category || 'A'}
                                        onChange={(e) => setEditingTool({ ...editingTool, rate_category: e.target.value })}
                                        className="select-input text-sm"
                                    >
                                        <option value="A">Category A</option>
                                        <option value="B">Category B</option>
                                        <option value="C">Category C</option>
                                        <option value="D">Category D</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase mb-1">
                                        Location
                                    </label>
                                    <input
                                        type="text"
                                        value={editingTool.location || ''}
                                        onChange={(e) => setEditingTool({ ...editingTool, location: e.target.value })}
                                        className="input-field text-sm"
                                    />
                                </div>
                            </div>

                            {/* Tool Responsible Selection (1 or 2 users) */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 bg-blue-50/50 dark:bg-blue-900/10 rounded-lg border border-blue-100 dark:border-blue-900/30">
                                <div>
                                    <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase mb-1 flex items-center gap-1">
                                        <Icon className="fas fa-user-shield text-blue-600 text-xs" />
                                        Primary Responsible
                                    </label>
                                    <select
                                        value={editingTool.primary_responsible_id || ''}
                                        onChange={(e) => setEditingTool({ ...editingTool, primary_responsible_id: e.target.value || null })}
                                        className="select-input text-xs w-full"
                                    >
                                        <option value="">Default (Administrator)</option>
                                        {availableUsers.map(u => (
                                            <option key={u.id} value={u.id}>
                                                {u.first_name} {u.last_name} ({u.access_level === 'admin' ? 'Admin' : u.job_title || 'User'})
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase mb-1 flex items-center gap-1">
                                        <Icon className="fas fa-user-plus text-blue-600 text-xs" />
                                        Secondary Responsible
                                    </label>
                                    <select
                                        value={editingTool.secondary_responsible_id || ''}
                                        onChange={(e) => setEditingTool({ ...editingTool, secondary_responsible_id: e.target.value || null })}
                                        className="select-input text-xs w-full"
                                    >
                                        <option value="">None</option>
                                        {availableUsers.map(u => (
                                            <option key={u.id} value={u.id}>
                                                {u.first_name} {u.last_name} ({u.access_level === 'admin' ? 'Admin' : u.job_title || 'User'})
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <div>
                                <label className="relative flex items-center gap-2 cursor-pointer select-none">
                                    <input
                                        type="checkbox"
                                        checked={editingTool.license_req}
                                        onChange={(e) => setEditingTool({ ...editingTool, license_req: e.target.checked })}
                                        className="w-4 h-4 rounded text-blue-600"
                                    />
                                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                        Require Operator License
                                    </span>
                                </label>
                            </div>

                            {/* Microsoft Bookings Two-Way Sync Configuration */}
                            <div className="p-3 bg-indigo-50/60 dark:bg-indigo-900/15 rounded-lg border border-indigo-100 dark:border-indigo-900/40 space-y-3">
                                <label className="relative flex items-center gap-2 cursor-pointer select-none">
                                    <input
                                        type="checkbox"
                                        checked={Boolean(editingTool.ms_bookings_sync_enabled)}
                                        onChange={(e) => setEditingTool({ ...editingTool, ms_bookings_sync_enabled: e.target.checked })}
                                        className="w-4 h-4 rounded text-indigo-600"
                                    />
                                    <span className="text-sm font-semibold text-gray-800 dark:text-gray-200 flex items-center gap-1.5">
                                        <Icon className="fas fa-sync-alt text-indigo-600 dark:text-indigo-400 text-xs" />
                                        Enable Microsoft Bookings 2-Way Sync
                                    </span>
                                </label>
                                {editingTool.ms_bookings_sync_enabled && (
                                    <div className="space-y-2.5 pt-1">
                                        <div>
                                            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase mb-1">
                                                Microsoft Bookings Page SMTP Address
                                            </label>
                                            <input
                                                type="email"
                                                required
                                                placeholder="RaithSystem@university.edu"
                                                value={editingTool.ms_bookings_email || ''}
                                                onChange={(e) => setEditingTool({ ...editingTool, ms_bookings_email: e.target.value })}
                                                className="input-field text-sm"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase mb-1">
                                                Default Service ID (Optional — Auto-Detected on First Booking)
                                            </label>
                                            <input
                                                type="text"
                                                placeholder="Auto-populated from Microsoft Bookings or paste Service GUID"
                                                value={editingTool.ms_bookings_service_id || ''}
                                                onChange={(e) => setEditingTool({ ...editingTool, ms_bookings_service_id: e.target.value })}
                                                className="input-field text-xs font-mono"
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase mb-1">
                                    Image URL
                                </label>
                                <input
                                    type="text"
                                    placeholder="https://example.com/photo.jpg"
                                    value={editingTool.image_url || ''}
                                    onChange={(e) => setEditingTool({ ...editingTool, image_url: e.target.value })}
                                    className="input-field text-sm"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase mb-1">
                                    Description & Notes
                                </label>
                                <textarea
                                    rows="3"
                                    value={editingTool.description || ''}
                                    onChange={(e) => setEditingTool({ ...editingTool, description: e.target.value })}
                                    className="input-field text-sm"
                                ></textarea>
                            </div>
                            <div className="flex justify-end gap-2 pt-2 border-t dark:border-gray-700">
                                <button
                                    type="button"
                                    onClick={() => setEditingTool(null)}
                                    className="btn btn-secondary btn-sm"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={isSavingEdit}
                                    className="btn btn-primary btn-sm flex items-center gap-1.5"
                                >
                                    {isSavingEdit && <Icon className="fas fa-spinner fa-spin" />}
                                    Save Changes
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
            {/* Rate & Pricing Guide Modal */}
            <RatePricingModal
                isOpen={isPricingModalOpen}
                onClose={() => setIsPricingModalOpen(false)}
            />

            {/* Microsoft Bookings Power Automate Setup Modal */}
            {isSyncGuideOpen && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                    <div
                        ref={syncGuideDialogRef}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="ms-sync-guide-title"
                        tabIndex={-1}
                        className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-3xl w-full p-6 space-y-5 border dark:border-gray-700 max-h-[90vh] overflow-y-auto"
                    >
                        <div className="flex justify-between items-center border-b dark:border-gray-700 pb-3">
                            <h3 id="ms-sync-guide-title" className="text-lg font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                                <Icon className="fas fa-sync-alt text-indigo-600 dark:text-indigo-400" />
                                Microsoft Bookings Power Automate Setup (Zero Admin Consent)
                            </h3>
                            <button
                                type="button"
                                onClick={() => setIsSyncGuideOpen(false)}
                                aria-label="Close Microsoft Bookings setup guide"
                                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                            >
                                <Icon className="fas fa-times text-lg" />
                            </button>
                        </div>

                        <div className="p-3 bg-indigo-50/70 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-lg text-xs text-indigo-900 dark:text-indigo-200 space-y-1">
                            <p className="font-semibold">No Entra ID App Registration or IT Tenant Admin approval needed.</p>
                            <p>
                                Create two Power Automate cloud flows under your personal M365 account (which already owns or has staff access to the instrument&apos;s Bookings page). Set <code className="font-mono bg-white/70 dark:bg-gray-900 px-1 rounded">MS_BOOKINGS_SYNC_SECRET</code> via <code className="font-mono bg-white/70 dark:bg-gray-900 px-1 rounded">supabase secrets set</code> and replace <code className="font-mono bg-white/70 dark:bg-gray-900 px-1 rounded">YOUR_SYNC_SECRET</code> below.
                            </p>
                        </div>

                        {syncedTools.length > 0 && (
                            <div>
                                <label htmlFor="sync-guide-tool-select" className="block text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase mb-1">
                                    Preview Configuration for Synced Instrument
                                </label>
                                <select
                                    id="sync-guide-tool-select"
                                    value={activeGuideTool?.id || ''}
                                    onChange={(e) => setSyncGuideToolId(e.target.value)}
                                    className="select-input text-sm w-full"
                                >
                                    {syncedTools.map(t => (
                                        <option key={t.id} value={t.id}>
                                            {t.name} — {t.ms_bookings_email} {t.ms_bookings_service_id ? `(Service: ${t.ms_bookings_service_id})` : '(Service ID auto-detect pending)'}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        )}

                        {/* Flow 1: Inbound */}
                        <div className="space-y-2.5 border dark:border-gray-700 rounded-lg p-4">
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                                <h4 className="font-bold text-sm text-gray-900 dark:text-gray-100">
                                    Flow 1 (Inbound): Microsoft Bookings → MMI-LIMS
                                </h4>
                                <span className="text-[11px] bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-200 px-2 py-0.5 rounded font-semibold">
                                    Standard Bookings Trigger
                                </span>
                            </div>
                            <p className="text-xs text-gray-600 dark:text-gray-300">
                                Trigger: <strong>Microsoft Bookings</strong> → <em>When an appointment is Created</em> (repeat for <em>Updated</em> and <em>Cancelled</em> with <code className="font-mono">event_type</code> set to <code className="font-mono">created</code>, <code className="font-mono">updated</code>, or <code className="font-mono">cancelled</code>).
                            </p>
                            <div className="space-y-1.5">
                                <div className="flex items-center justify-between">
                                    <span className="text-[11px] font-semibold text-gray-600 dark:text-gray-400 uppercase">Option A: JSON POST Endpoint (HTTP / Office Script)</span>
                                    <button
                                        type="button"
                                        onClick={() => copySnippet('Inbound POST URL', `${syncEndpointUrl}?action=inbound`)}
                                        className="text-xs text-blue-600 dark:text-blue-400 hover:underline font-semibold"
                                    >
                                        Copy URL
                                    </button>
                                </div>
                                <pre className="text-[11px] font-mono bg-gray-50 dark:bg-gray-900 border dark:border-gray-700 rounded p-2.5 overflow-x-auto text-gray-800 dark:text-gray-200">{`POST ${syncEndpointUrl}?action=inbound
Authorization: Bearer YOUR_SYNC_SECRET
Content-Type: application/json

{
  "ms_bookings_email": "${guideBookingsEmail}",
  "event_type": "created",
  "external_id": "@{triggerOutputs()?['body/Id']}",
  "starts_at": "@{triggerOutputs()?['body/StartTime']}",
  "ends_at": "@{triggerOutputs()?['body/EndTime']}",
  "service_id": "@{triggerOutputs()?['body/ServiceId']}",
  "service_name": "@{triggerOutputs()?['body/ServiceName']}",
  "staff_email": "@{first(triggerOutputs()?['body/StaffMembers'])?['EmailAddress']}",
  "staff_id": "@{first(triggerOutputs()?['body/StaffMembers'])?['Id']}",
  "customer_email": "@{triggerOutputs()?['body/CustomerEmail']}",
  "customer_name": "@{triggerOutputs()?['body/CustomerName']}",
  "notes": "@{concat(triggerOutputs()?['body/CustomerNotes'], ' ', triggerOutputs()?['body/ServiceNotes'])}"
}`}</pre>
                            </div>
                            <div className="space-y-1.5">
                                <div className="flex items-center justify-between">
                                    <span className="text-[11px] font-semibold text-gray-600 dark:text-gray-400 uppercase">Option B: 100% Free Standard RSS Connector (GET)</span>
                                    <button
                                        type="button"
                                        onClick={() => copySnippet('Inbound RSS GET URL', `${syncEndpointUrl}?action=inbound&secret=YOUR_SYNC_SECRET&ms_bookings_email=${encodeURIComponent(guideBookingsEmail)}&event_type=created&external_id=@{triggerOutputs()?['body/Id']}&starts_at=@{triggerOutputs()?['body/StartTime']}&ends_at=@{triggerOutputs()?['body/EndTime']}&service_id=@{triggerOutputs()?['body/ServiceId']}&service_name=@{triggerOutputs()?['body/ServiceName']}&staff_email=@{first(triggerOutputs()?['body/StaffMembers'])?['EmailAddress']}&staff_id=@{first(triggerOutputs()?['body/StaffMembers'])?['Id']}&customer_email=@{triggerOutputs()?['body/CustomerEmail']}&customer_name=@{triggerOutputs()?['body/CustomerName']}&notes=@{triggerOutputs()?['body/ServiceNotes']}`)}
                                        className="text-xs text-blue-600 dark:text-blue-400 hover:underline font-semibold"
                                    >
                                        Copy URL
                                    </button>
                                </div>
                                <p className="text-[11px] text-gray-600 dark:text-gray-400">
                                    Use the free <strong>RSS → List all RSS feed items</strong> action with the copied URL (swap <code className="font-mono">event_type=created</code> for <code className="font-mono">updated</code> / <code className="font-mono">cancelled</code>).
                                </p>
                            </div>
                        </div>

                        {/* Flow 2: Outbound */}
                        <div className="space-y-2.5 border dark:border-gray-700 rounded-lg p-4">
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                                <h4 className="font-bold text-sm text-gray-900 dark:text-gray-100">
                                    Flow 2 (Outbound): MMI-LIMS → Microsoft Bookings Native Appointment
                                </h4>
                                <span className="text-[11px] bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-200 px-2 py-0.5 rounded font-semibold">
                                    Preauthorized Graph Connector
                                </span>
                            </div>
                            <ol className="text-xs text-gray-600 dark:text-gray-300 list-decimal pl-4 space-y-1.5">
                                <li>
                                    <strong>Poll Outbox</strong> (every 1–5 min via <strong>RSS → When a feed item is published</strong> or <strong>Recurrence + RSS → List all RSS feed items</strong>):
                                    <div className="flex items-center gap-2 mt-1">
                                        <code className="text-[11px] font-mono bg-gray-50 dark:bg-gray-900 border dark:border-gray-700 rounded px-2 py-1 flex-1 overflow-x-auto">
                                            {`${syncEndpointUrl}?action=outbox&secret=YOUR_SYNC_SECRET`}
                                        </code>
                                        <button
                                            type="button"
                                            onClick={() => copySnippet('Outbox RSS URL', `${syncEndpointUrl}?action=outbox&secret=YOUR_SYNC_SECRET`)}
                                            className="text-xs text-blue-600 dark:text-blue-400 hover:underline font-semibold shrink-0"
                                        >
                                            Copy
                                        </button>
                                    </div>
                                    <span className="text-[11px] text-gray-500 dark:text-gray-400 block mt-0.5">
                                        Parse the item&apos;s <code className="font-mono">summary</code>/<code className="font-mono">description</code> JSON using <strong>Data Operation → Parse JSON</strong>.
                                    </span>
                                </li>
                                <li>
                                    <strong>Create / Update / Cancel inside Microsoft Bookings</strong> using <strong>HTTP with Microsoft Entra ID (preauthorized)</strong> (Base Resource URL &amp; Resource URI: <code className="font-mono">https://graph.microsoft.com</code> — signs in with your own account, zero admin consent):
                                    <ul className="list-disc pl-4 mt-1 space-y-0.5 text-[11px]">
                                        <li><strong>Method:</strong> <code className="font-mono">{`@{body('Parse_JSON')?['graph_method']}`}</code></li>
                                        <li><strong>Url of the request:</strong> <code className="font-mono">{`https://graph.microsoft.com@{body('Parse_JSON')?['graph_endpoint']}`}</code></li>
                                        <li><strong>Body:</strong> <code className="font-mono">{`@{body('Parse_JSON')?['graph_body']}`}</code></li>
                                    </ul>
                                </li>
                                <li>
                                    <strong>Acknowledge Job</strong> (via <strong>RSS → List all RSS feed items</strong> or HTTP POST) so MMI-LIMS saves the new Bookings Appointment ID:
                                    <div className="flex items-center gap-2 mt-1">
                                        <code className="text-[11px] font-mono bg-gray-50 dark:bg-gray-900 border dark:border-gray-700 rounded px-2 py-1 flex-1 overflow-x-auto">
                                            {`${syncEndpointUrl}?action=ack&secret=YOUR_SYNC_SECRET&job_id=@{body('Parse_JSON')?['job_id']}&external_id=@{body('Invoke_an_HTTP_request')?['id']}`}
                                        </code>
                                        <button
                                            type="button"
                                            onClick={() => copySnippet('Ack RSS URL', `${syncEndpointUrl}?action=ack&secret=YOUR_SYNC_SECRET&job_id=@{body('Parse_JSON')?['job_id']}&external_id=@{body('Invoke_an_HTTP_request')?['id']}`)}
                                            className="text-xs text-blue-600 dark:text-blue-400 hover:underline font-semibold shrink-0"
                                        >
                                            Copy
                                        </button>
                                    </div>
                                </li>
                            </ol>
                        </div>

                        <div className="flex justify-end pt-2 border-t dark:border-gray-700">
                            <button
                                type="button"
                                onClick={() => setIsSyncGuideOpen(false)}
                                className="btn btn-primary btn-sm"
                            >
                                Done
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default InfrastructureManagement;
