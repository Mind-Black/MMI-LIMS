import React, { useState, useMemo } from 'react';
import Icon from './Icon';
import StatusBadge from './StatusBadge';
import {
    getToolAccessLevel,
    isToolResponsibleUser,
    TOOL_ACCESS_LEVELS
} from '../utils/bookingUtils';

const toolImages = import.meta.glob('../assets/tool_thumbnails/*.{jpg,webp,avif}', { eager: true, import: 'default' });

const getToolImage = (id, width = 256, extension = 'jpg') =>
    toolImages[`../assets/tool_thumbnails/${id}-${width}.${extension}`] || null;

const ToolResponsibleBadge = ({ responsible }) => {
    if (!responsible) {
        return (
            <div className="text-xs text-gray-500 dark:text-gray-400">
                <span className="font-medium text-gray-700 dark:text-gray-300">Lab Administration</span>
            </div>
        );
    }

    const name = `${responsible.first_name || ''} ${responsible.last_name || ''}`.trim() || 'Administrator';

    return (
        <div className="text-xs text-gray-700 dark:text-gray-300">
            <div className="font-semibold text-gray-800 dark:text-gray-200 flex items-center gap-1">
                <Icon className="fas fa-user-shield text-blue-600 dark:text-blue-400 text-[11px]" />
                <span>{name}</span>
            </div>
            {responsible.job_title && (
                <div className="text-gray-500 dark:text-gray-400 text-[11px] truncate max-w-[180px]">
                    {responsible.job_title}
                </div>
            )}
            {responsible.email && (
                <a
                    href={`mailto:${responsible.email}`}
                    className="text-blue-600 dark:text-blue-400 hover:underline text-[11px] flex items-center gap-1 mt-0.5"
                    onClick={(e) => e.stopPropagation()}
                >
                    <Icon className="fas fa-envelope text-[10px]" />
                    <span className="truncate max-w-[180px]">{responsible.email}</span>
                </a>
            )}
            {responsible.phone && (
                <div className="text-gray-500 dark:text-gray-400 text-[11px] flex items-center gap-1 mt-0.5">
                    <Icon className="fas fa-phone text-[10px]" />
                    <span>{responsible.phone}</span>
                </div>
            )}
        </div>
    );
};

const AccessLevelBadge = ({ level, licenseReq }) => {
    if (!licenseReq) {
        return (
            <span className="text-green-700 dark:text-green-400 text-xs font-bold bg-green-50 dark:bg-green-900/20 px-2 py-1 rounded inline-flex items-center gap-1">
                <Icon className="fas fa-door-open" /> Open Access
            </span>
        );
    }

    switch (level) {
        case TOOL_ACCESS_LEVELS.LEVEL_3:
            return (
                <span className="text-green-700 dark:text-green-400 font-bold flex items-center gap-1 text-xs bg-green-50 dark:bg-green-900/20 px-2 py-1 rounded">
                    <Icon className="fas fa-award" /> Level III: Licensed
                </span>
            );
        case TOOL_ACCESS_LEVELS.LEVEL_2:
            return (
                <span className="text-blue-700 dark:text-blue-400 font-bold flex items-center gap-1 text-xs bg-blue-50 dark:bg-blue-900/20 px-2 py-1 rounded">
                    <Icon className="fas fa-user-check" /> Level II: Supervised
                </span>
            );
        case TOOL_ACCESS_LEVELS.LEVEL_1:
            return (
                <span className="text-amber-700 dark:text-amber-400 font-bold flex items-center gap-1 text-xs bg-amber-50 dark:bg-amber-900/20 px-2 py-1 rounded">
                    <Icon className="fas fa-user-graduate" /> Level I: In Training
                </span>
            );
        default:
            return (
                <span className="text-gray-400 dark:text-gray-500 flex items-center gap-1 text-xs bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded">
                    <Icon className="fas fa-times-circle" /> No License
                </span>
            );
    }
};

const ToolTable = ({
    toolsList,
    title,
    profile,
    onStatusChange,
    onBook,
    onApply,
    expandedToolId,
    onToggleExpand,
    pendingRequestsByTool = {},
    pendingBookingsByTool = {},
    onApproveRequest,
    onRejectRequest,
    onConfirmBooking,
    onRejectBooking
}) => {
    const isAdmin = profile?.access_level === 'admin';

    return (
        <div className="card mb-8">
            <div className="card-header font-bold text-gray-700 dark:text-gray-200 flex justify-between items-center">
                <span>{title} ({toolsList.length})</span>
            </div>

            {/* Mobile Card View */}
            <div className="lg:hidden divide-y dark:divide-gray-700">
                {toolsList.map(tool => {
                    const level = getToolAccessLevel(profile, tool.id);
                    const isResponsible = isToolResponsibleUser(tool, profile) || isAdmin;
                    const toolPendingReqs = pendingRequestsByTool[tool.id] || [];
                    const toolPendingBookings = pendingBookingsByTool[tool.id] || [];
                    const pendingCount = isResponsible ? (toolPendingReqs.length + toolPendingBookings.length) : 0;
                    const canBook = isAdmin || !tool.license_req || level === TOOL_ACCESS_LEVELS.LEVEL_2 || level === TOOL_ACCESS_LEVELS.LEVEL_3;

                    return (
                        <article key={tool.id} className="p-4 min-w-0 space-y-3">
                            <div className="flex justify-between gap-3 items-start">
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                        <h4 className="font-bold text-gray-800 dark:text-gray-100 break-words">{tool.name}</h4>
                                        {pendingCount > 0 && (
                                            <span className="bg-amber-500 text-white text-[11px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 shadow-sm" title={`${pendingCount} pending items`}>
                                                <Icon className="fas fa-bell text-[10px]" /> {pendingCount}
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-sm text-gray-500 dark:text-gray-400">{tool.category} · ID {tool.id} {tool.location ? `· ${tool.location}` : ''}</p>
                                </div>
                                <StatusBadge status={tool.status} />
                            </div>

                            <div className="flex items-center justify-between text-sm">
                                <span className="text-gray-600 dark:text-gray-300 font-medium">Access:</span>
                                <AccessLevelBadge level={level} licenseReq={tool.license_req} />
                            </div>

                            {/* Tool Responsible Mobile Info */}
                            <div className="bg-gray-50 dark:bg-gray-900/40 p-2.5 rounded-lg border dark:border-gray-700">
                                <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400 block mb-1">Tool Responsible</span>
                                <ToolResponsibleBadge responsible={tool.primary_responsible} />
                            </div>

                            {expandedToolId === tool.id && (
                                <p className="text-sm text-gray-700 dark:text-gray-300 break-words">
                                    {tool.description || 'No description provided.'}
                                </p>
                            )}

                            {isAdmin && (
                                <label className="block text-sm text-gray-700 dark:text-gray-300">
                                    Equipment status
                                    <select
                                        aria-label={`Status for ${tool.name}`}
                                        value={tool.status}
                                        onChange={e => onStatusChange(tool.id, e.target.value)}
                                        className="select-input ml-2 text-sm"
                                    >
                                        <option value="up">Available</option>
                                        <option value="down">Unavailable</option>
                                        <option value="service">Under maintenance</option>
                                    </select>
                                </label>
                            )}

                            <div className="flex flex-wrap gap-2 pt-1">
                                <button
                                    type="button"
                                    className="btn btn-secondary btn-sm"
                                    onClick={() => onToggleExpand(tool.id)}
                                    aria-expanded={expandedToolId === tool.id}
                                >
                                    {expandedToolId === tool.id ? 'Hide details' : 'Details'}
                                </button>

                                {canBook && (
                                    <button
                                        type="button"
                                        className="btn btn-primary btn-sm"
                                        onClick={() => onBook(tool)}
                                    >
                                        View availability / Book
                                    </button>
                                )}

                                {!canBook && tool.license_req && level === TOOL_ACCESS_LEVELS.NONE && onApply && (
                                    <button
                                        type="button"
                                        className="btn btn-secondary btn-sm text-blue-600 dark:text-blue-400 flex items-center gap-1.5"
                                        onClick={() => onApply(tool)}
                                    >
                                        <Icon className="fas fa-graduation-cap" />
                                        Apply for Training
                                    </button>
                                )}

                                {!canBook && tool.license_req && level === TOOL_ACCESS_LEVELS.LEVEL_1 && (
                                    <button
                                        type="button"
                                        disabled
                                        className="btn btn-secondary btn-sm opacity-60 cursor-not-allowed text-amber-700 dark:text-amber-300"
                                        title="Level I users are undergoing training and cannot book"
                                    >
                                        <Icon className="fas fa-user-graduate" /> In Training
                                    </button>
                                )}
                            </div>
                        </article>
                    );
                })}
            </div>

            {/* Desktop Table View */}
            <table className="hidden lg:table w-full text-left border-collapse">
                <thead className="bg-gray-50 dark:bg-gray-900 border-b dark:border-gray-700 transition-colors">
                    <tr>
                        <th className="p-3 font-semibold text-gray-600 dark:text-gray-300">ID</th>
                        <th className="p-3 font-semibold text-gray-600 dark:text-gray-300">Equipment</th>
                        <th className="p-3 font-semibold text-gray-600 dark:text-gray-300">Category</th>
                        <th className="p-3 font-semibold text-gray-600 dark:text-gray-300">Tool Responsible</th>
                        <th className="p-3 font-semibold text-gray-600 dark:text-gray-300">Status</th>
                        <th className="p-3 font-semibold text-gray-600 dark:text-gray-300">Access Level</th>
                        <th className="p-3 font-semibold text-gray-600 dark:text-gray-300 text-right">Action</th>
                    </tr>
                </thead>
                <tbody>
                    {toolsList.map(tool => {
                        const toolImage = getToolImage(tool.id);
                        const level = getToolAccessLevel(profile, tool.id);
                        const isResponsible = isToolResponsibleUser(tool, profile) || isAdmin;
                        const toolPendingReqs = pendingRequestsByTool[tool.id] || [];
                        const toolPendingBookings = pendingBookingsByTool[tool.id] || [];
                        const pendingCount = isResponsible ? (toolPendingReqs.length + toolPendingBookings.length) : 0;
                        const canBook = isAdmin || !tool.license_req || level === TOOL_ACCESS_LEVELS.LEVEL_2 || level === TOOL_ACCESS_LEVELS.LEVEL_3;

                        return (
                            <React.Fragment key={tool.id}>
                                <tr className={`tool-row border-b dark:border-gray-700 last:border-0 transition-colors hover:bg-blue-50/50 dark:hover:bg-blue-900/10 ${expandedToolId === tool.id ? 'bg-blue-50/30 dark:bg-blue-900/5' : ''}`}>
                                    <td className="p-3 text-gray-500 dark:text-gray-400 font-mono text-sm">{tool.id}</td>
                                    <td className="p-3">
                                        <div className="flex items-center gap-2">
                                            <button
                                                type="button"
                                                onClick={() => onToggleExpand(tool.id)}
                                                aria-expanded={expandedToolId === tool.id}
                                                className="font-bold text-left text-gray-800 dark:text-gray-200 hover:underline"
                                            >
                                                {tool.name} <span className="sr-only">details</span>
                                            </button>
                                            {pendingCount > 0 && (
                                                <span
                                                    className="bg-amber-500 text-white text-[11px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 shadow-sm cursor-pointer"
                                                    onClick={() => onToggleExpand(tool.id)}
                                                    title={`${pendingCount} pending items for ${tool.name}`}
                                                >
                                                    <Icon className="fas fa-bell text-[10px]" /> {pendingCount}
                                                </span>
                                            )}
                                        </div>
                                    </td>
                                    <td className="p-3">
                                        <span className="bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-2 py-1 rounded text-xs font-semibold">
                                            {tool.category}
                                        </span>
                                    </td>
                                    <td className="p-3">
                                        <ToolResponsibleBadge responsible={tool.primary_responsible} />
                                    </td>
                                    <td className="p-3">
                                        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                                            <StatusBadge status={tool.status} />
                                            {isAdmin && (
                                                <select
                                                    aria-label={`Status for ${tool.name}`}
                                                    value={tool.status}
                                                    onChange={(e) => onStatusChange(tool.id, e.target.value)}
                                                    className="select-input text-xs p-1"
                                                >
                                                    <option value="up">Up</option>
                                                    <option value="down">Down</option>
                                                    <option value="service">Service</option>
                                                </select>
                                            )}
                                        </div>
                                    </td>
                                    <td className="p-3">
                                        <AccessLevelBadge level={level} licenseReq={tool.license_req} />
                                    </td>
                                    <td className="p-3 text-right">
                                        <div className="flex justify-end gap-1.5">
                                            {canBook && (
                                                <button
                                                    onClick={() => onBook(tool)}
                                                    className="btn btn-primary btn-sm"
                                                >
                                                    Book
                                                </button>
                                            )}
                                            {!canBook && tool.license_req && level === TOOL_ACCESS_LEVELS.NONE && onApply && (
                                                <button
                                                    onClick={() => onApply(tool)}
                                                    className="btn btn-secondary btn-sm text-blue-600 dark:text-blue-400 flex items-center gap-1"
                                                    title="Apply for equipment training license"
                                                >
                                                    <Icon className="fas fa-graduation-cap" />
                                                    Apply
                                                </button>
                                            )}
                                            {!canBook && tool.license_req && level === TOOL_ACCESS_LEVELS.LEVEL_1 && (
                                                <button
                                                    disabled
                                                    className="btn btn-secondary btn-sm opacity-60 cursor-not-allowed text-amber-700 dark:text-amber-300"
                                                    title="Level I users are undergoing training and cannot book"
                                                >
                                                    In Training
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                </tr>

                                {/* Expanded Details Drawer */}
                                {expandedToolId === tool.id && (
                                    <tr className="bg-gray-50 dark:bg-gray-900/50 border-b dark:border-gray-700">
                                        <td colSpan="7" className="p-6">
                                            <div className="flex flex-col md:flex-row gap-6 animate-fadeIn">
                                                {/* Image */}
                                                {tool.image_url ? (
                                                    <div className="w-full md:w-64 h-48 bg-white dark:bg-gray-800 rounded-lg flex items-center justify-center shrink-0 border dark:border-gray-700 overflow-hidden">
                                                        <img src={tool.image_url} alt={tool.name} loading="lazy" decoding="async" className="w-full h-full object-cover" />
                                                    </div>
                                                ) : toolImage ? (
                                                    <div className="w-full md:w-64 h-48 bg-white dark:bg-gray-800 rounded-lg flex items-center justify-center shrink-0 border dark:border-gray-700 overflow-hidden">
                                                        <picture className="w-full h-full">
                                                            <source type="image/avif" srcSet={`${getToolImage(tool.id, 256, 'avif')} 1x, ${getToolImage(tool.id, 512, 'avif')} 2x`} />
                                                            <source type="image/webp" srcSet={`${getToolImage(tool.id, 256, 'webp')} 1x, ${getToolImage(tool.id, 512, 'webp')} 2x`} />
                                                            <img src={toolImage} srcSet={`${getToolImage(tool.id, 256)} 1x, ${getToolImage(tool.id, 512)} 2x`} alt={tool.name} loading="lazy" decoding="async" width="256" height="192" className="w-full h-full object-cover" />
                                                        </picture>
                                                    </div>
                                                ) : (
                                                    <div className="w-full md:w-64 h-48 bg-gray-200 dark:bg-gray-800 rounded-lg flex items-center justify-center text-gray-400 dark:text-gray-600 shrink-0 border dark:border-gray-700">
                                                        <div className="text-center">
                                                            <Icon className="fas fa-camera text-4xl mb-2" />
                                                            <div className="text-xs">No Image Available</div>
                                                        </div>
                                                    </div>
                                                )}

                                                {/* Details & Responsible Information */}
                                                <div className="flex-1 space-y-4">
                                                    <div>
                                                        <h4 className="font-bold text-lg text-gray-800 dark:text-gray-200 mb-1">{tool.name}</h4>
                                                        <p className="text-gray-700 dark:text-gray-300 text-sm leading-relaxed">
                                                            {tool.description || 'No description provided.'}
                                                        </p>
                                                    </div>

                                                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                                                        <div>
                                                            <div className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Category</div>
                                                            <div className="text-sm text-gray-800 dark:text-gray-200 font-medium">{tool.category}</div>
                                                        </div>
                                                        <div>
                                                            <div className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Location</div>
                                                            <div className="text-sm text-gray-800 dark:text-gray-200 font-medium">{tool.location || 'Main Cleanroom'}</div>
                                                        </div>
                                                        <div>
                                                            <div className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">System ID</div>
                                                            <div className="text-sm font-mono text-gray-800 dark:text-gray-200">{tool.id}</div>
                                                        </div>
                                                    </div>

                                                    {/* Tool Responsible Details Card */}
                                                    <div className="border dark:border-gray-700 rounded-lg p-3 bg-white dark:bg-gray-800 shadow-xs">
                                                        <div className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                                            <Icon className="fas fa-id-badge text-blue-600 dark:text-blue-400" />
                                                            Tool Responsible Contact Details
                                                        </div>
                                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                                            <div>
                                                                <span className="text-[11px] text-gray-400 font-medium uppercase block">Primary Contact</span>
                                                                <ToolResponsibleBadge responsible={tool.primary_responsible} />
                                                            </div>
                                                            {tool.secondary_responsible && (
                                                                <div>
                                                                    <span className="text-[11px] text-gray-400 font-medium uppercase block">Secondary Contact</span>
                                                                    <ToolResponsibleBadge responsible={tool.secondary_responsible} />
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>

                                                    {/* Tool Responsible Pending Actions Section */}
                                                    {isResponsible && (toolPendingReqs.length > 0 || toolPendingBookings.length > 0) && (
                                                        <div className="border border-amber-200 dark:border-amber-800/40 rounded-lg p-3 bg-amber-50/50 dark:bg-amber-900/10 space-y-3">
                                                            <div className="font-bold text-sm text-amber-900 dark:text-amber-200 flex items-center gap-2">
                                                                <Icon className="fas fa-bell text-amber-600 dark:text-amber-400" />
                                                                Pending Actions for Tool Responsible
                                                            </div>

                                                            {/* Pending Training Requests */}
                                                            {toolPendingReqs.length > 0 && (
                                                                <div className="space-y-2">
                                                                    <h5 className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">
                                                                        Training Requests ({toolPendingReqs.length})
                                                                    </h5>
                                                                    <div className="space-y-2">
                                                                        {toolPendingReqs.map(req => (
                                                                            <div key={req.id} className="p-2.5 bg-white dark:bg-gray-800 rounded border dark:border-gray-700 text-xs flex flex-col sm:flex-row justify-between sm:items-center gap-2">
                                                                                <div>
                                                                                    <div className="font-semibold text-gray-800 dark:text-gray-100">{req.user_name} ({req.user_email || 'No email'})</div>
                                                                                    <div className="text-gray-600 dark:text-gray-400 mt-0.5">
                                                                                        Preferred Date: <strong>{req.preferred_date}</strong> &bull; Note: &ldquo;{req.description}&rdquo;
                                                                                    </div>
                                                                                </div>
                                                                                <div className="flex gap-1.5 shrink-0">
                                                                                    <button
                                                                                        type="button"
                                                                                        onClick={() => onApproveRequest?.(req)}
                                                                                        className="btn btn-primary btn-sm py-1 text-xs"
                                                                                        title="Approve and assign Level I (In Training)"
                                                                                    >
                                                                                        Approve (Level I)
                                                                                    </button>
                                                                                    <button
                                                                                        type="button"
                                                                                        onClick={() => onRejectRequest?.(req)}
                                                                                        className="btn btn-secondary btn-sm py-1 text-xs text-red-600 hover:text-red-700"
                                                                                    >
                                                                                        Reject
                                                                                    </button>
                                                                                </div>
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                </div>
                                                            )}

                                                            {/* Pending Level II Bookings */}
                                                            {toolPendingBookings.length > 0 && (
                                                                <div className="space-y-2">
                                                                    <h5 className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">
                                                                        Level II Reservations Awaiting Confirmation ({toolPendingBookings.length})
                                                                    </h5>
                                                                    <div className="space-y-2">
                                                                        {toolPendingBookings.map(b => (
                                                                            <div key={b.id} className="p-2.5 bg-white dark:bg-gray-800 rounded border dark:border-gray-700 text-xs flex flex-col sm:flex-row justify-between sm:items-center gap-2">
                                                                                <div>
                                                                                    <div className="font-semibold text-gray-800 dark:text-gray-100">{b.user_name} &bull; Project: {b.project}</div>
                                                                                    <div className="text-gray-600 dark:text-gray-400 mt-0.5">
                                                                                        Date: <strong>{b.date}</strong> &bull; Time: <strong>{b.time?.slice(0, 5)} - {b.end_time?.slice(0, 5)}</strong> (Tentatively Held)
                                                                                    </div>
                                                                                </div>
                                                                                <div className="flex gap-1.5 shrink-0">
                                                                                    <button
                                                                                        type="button"
                                                                                        onClick={() => onConfirmBooking?.(b)}
                                                                                        className="btn btn-primary btn-sm py-1 text-xs"
                                                                                        title="Confirm reservation to publish on active calendar"
                                                                                    >
                                                                                        Confirm
                                                                                    </button>
                                                                                    <button
                                                                                        type="button"
                                                                                        onClick={() => onRejectBooking?.(b)}
                                                                                        className="btn btn-secondary btn-sm py-1 text-xs text-red-600 hover:text-red-700"
                                                                                    >
                                                                                        Reject
                                                                                    </button>
                                                                                </div>
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </td>
                                    </tr>
                                )}
                            </React.Fragment>
                        );
                    })}
                </tbody>
            </table>

            {toolsList.length === 0 && (
                <div className="p-8 text-center text-gray-500 dark:text-gray-400">
                    No tools found in this section.
                </div>
            )}
        </div>
    );
};

const ToolList = ({
    tools = [],
    profile,
    onStatusChange,
    onBook,
    onOpenAddModal,
    onApplyTraining,
    pendingRequests = [],
    pendingBookings = [],
    onApproveRequest,
    onRejectRequest,
    onConfirmBooking,
    onRejectBooking
}) => {
    const [filterCategory, setFilterCategory] = useState('All');
    const [searchQuery, setSearchQuery] = useState('');
    const [expandedToolId, setExpandedToolId] = useState(null);

    const handleToggleExpand = (id) => {
        setExpandedToolId(prev => (prev === id ? null : id));
    };

    const categories = useMemo(() => {
        const cats = new Set(tools.map(t => t.category));
        return ['All', ...Array.from(cats).sort()];
    }, [tools]);

    // Map pending items by tool_id for instant O(1) lookup
    const pendingRequestsByTool = useMemo(() => {
        const map = {};
        for (const req of pendingRequests) {
            if (!map[req.tool_id]) map[req.tool_id] = [];
            map[req.tool_id].push(req);
        }
        return map;
    }, [pendingRequests]);

    const pendingBookingsByTool = useMemo(() => {
        const map = {};
        for (const b of pendingBookings) {
            if (!map[b.tool_id]) map[b.tool_id] = [];
            map[b.tool_id].push(b);
        }
        return map;
    }, [pendingBookings]);

    const filteredTools = tools.filter(t => {
        const matchesCategory = filterCategory === 'All' || t.category === filterCategory;
        const matchesSearch = t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            t.id.toString().includes(searchQuery) ||
            (t.description && t.description.toLowerCase().includes(searchQuery.toLowerCase()));
        return matchesCategory && matchesSearch;
    });

    const isAuthorized = (t) => {
        if (profile?.access_level === 'admin' || !t.license_req) return true;
        const level = getToolAccessLevel(profile, t.id);
        return level === TOOL_ACCESS_LEVELS.LEVEL_2 || level === TOOL_ACCESS_LEVELS.LEVEL_3;
    };

    const isInTraining = (t) => {
        if (!t.license_req || isAuthorized(t)) return false;
        return getToolAccessLevel(profile, t.id) === TOOL_ACCESS_LEVELS.LEVEL_1;
    };

    const authorizedTools = filteredTools.filter(isAuthorized);
    const trainingTools = filteredTools.filter(isInTraining);
    const otherTools = filteredTools.filter(t => !isAuthorized(t) && !isInTraining(t));

    return (
        <div className="space-y-4">
            <div className="flex flex-col md:flex-row gap-4 card p-4">
                <div className="flex-1">
                    <input
                        aria-label="Search equipment"
                        type="text"
                        placeholder="Search tool name, ID, or description..."
                        className="input-field"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <select
                        aria-label="Filter equipment by category"
                        className="select-input"
                        value={filterCategory}
                        onChange={(e) => setFilterCategory(e.target.value)}
                    >
                        {categories.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    {profile?.access_level === 'admin' && onOpenAddModal && (
                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={() => onOpenAddModal('single')}
                                className="btn btn-primary btn-sm flex items-center gap-1.5 whitespace-nowrap"
                            >
                                <Icon className="fas fa-plus" />
                                Add Equipment
                            </button>
                            <button
                                type="button"
                                onClick={() => onOpenAddModal('bulk')}
                                className="btn btn-secondary btn-sm flex items-center gap-1.5 whitespace-nowrap"
                                title="Import equipment from CSV file"
                            >
                                <Icon className="fas fa-file-csv" />
                                Import CSV
                            </button>
                        </div>
                    )}
                </div>
            </div>

            <ToolTable
                toolsList={authorizedTools}
                title="My Authorized Equipment"
                profile={profile}
                onStatusChange={onStatusChange}
                onBook={onBook}
                onApply={onApplyTraining}
                expandedToolId={expandedToolId}
                onToggleExpand={handleToggleExpand}
                pendingRequestsByTool={pendingRequestsByTool}
                pendingBookingsByTool={pendingBookingsByTool}
                onApproveRequest={onApproveRequest}
                onRejectRequest={onRejectRequest}
                onConfirmBooking={onConfirmBooking}
                onRejectBooking={onRejectBooking}
            />

            {trainingTools.length > 0 && (
                <ToolTable
                    toolsList={trainingTools}
                    title="Equipment In Training (Level I)"
                    profile={profile}
                    onStatusChange={onStatusChange}
                    onBook={onBook}
                    onApply={onApplyTraining}
                    expandedToolId={expandedToolId}
                    onToggleExpand={handleToggleExpand}
                    pendingRequestsByTool={pendingRequestsByTool}
                    pendingBookingsByTool={pendingBookingsByTool}
                    onApproveRequest={onApproveRequest}
                    onRejectRequest={onRejectRequest}
                    onConfirmBooking={onConfirmBooking}
                    onRejectBooking={onRejectBooking}
                />
            )}

            <ToolTable
                toolsList={otherTools}
                title="Other Available Equipment"
                profile={profile}
                onStatusChange={onStatusChange}
                onBook={onBook}
                onApply={onApplyTraining}
                expandedToolId={expandedToolId}
                onToggleExpand={handleToggleExpand}
                pendingRequestsByTool={pendingRequestsByTool}
                pendingBookingsByTool={pendingBookingsByTool}
                onApproveRequest={onApproveRequest}
                onRejectRequest={onRejectRequest}
                onConfirmBooking={onConfirmBooking}
                onRejectBooking={onRejectBooking}
            />
        </div>
    );
};

export default ToolList;
