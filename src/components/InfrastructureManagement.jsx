import React, { useState, useMemo } from 'react';
import Icon from './Icon';
import StatusBadge from './StatusBadge';
import { supabase } from '../supabaseClient';
import { useToast } from '../context/useToast';
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
    const [filterStatus, setFilterStatus] = useState('All');
    const [editingTool, setEditingTool] = useState(null);
    const [isSavingEdit, setIsSavingEdit] = useState(false);
    const [deletingToolId, setDeletingToolId] = useState(null);
    const { showToast } = useToast();

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
            const matchesQuery = !searchQuery.trim() ||
                tool.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                String(tool.id).includes(searchQuery) ||
                (tool.location && tool.location.toLowerCase().includes(searchQuery.toLowerCase())) ||
                (tool.description && tool.description.toLowerCase().includes(searchQuery.toLowerCase()));
            return matchesCat && matchesStatus && matchesQuery;
        });
    }, [tools, filterCategory, filterStatus, searchQuery]);

    // Save edited metadata
    const handleSaveEdit = async (e) => {
        e.preventDefault();
        if (!editingTool) return;

        setIsSavingEdit(true);
        const updates = {
            name: editingTool.name.trim(),
            category: editingTool.category.trim(),
            location: editingTool.location?.trim() || null,
            license_req: Boolean(editingTool.license_req),
            description: editingTool.description?.trim() || null,
            image_url: editingTool.image_url?.trim() || null
        };

        try {
            let { data, error } = await supabase
                .from('tools')
                .update(updates)
                .eq('id', editingTool.id)
                .select('id, name, category, status, location, license_req, description, image_url')
                .single();

            // Fallback if image_url column not yet applied on DB
            if (error && error.message && error.message.includes('image_url')) {
                const legacyUpdates = { ...updates };
                delete legacyUpdates.image_url;
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

            showToast(`Updated "${data.name}" successfully!`, 'success');
            if (onToolsChange) {
                onToolsChange(prev => prev.map(t => t.id === data.id ? { ...t, ...data } : t));
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
                        Configure laboratory equipment, register new instruments, and manage operational statuses.
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
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
                                <th className="p-3 text-xs font-semibold text-gray-600 dark:text-gray-300">Category</th>
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
                                                    <div className="font-bold text-gray-800 dark:text-gray-200">
                                                        {tool.name}
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
                                            <span className="bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded text-xs font-semibold">
                                                {tool.category}
                                            </span>
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
                                                    title="Edit equipment metadata"
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
                    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-lg w-full p-6 space-y-4 border dark:border-gray-700">
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
                            <div className="grid grid-cols-2 gap-3">
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
        </div>
    );
};

export default InfrastructureManagement;
