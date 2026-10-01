import React, { useState, useMemo } from 'react';
import Icon from './Icon';
import StatusBadge from './StatusBadge';
import RateCategoryBadge from './RateCategoryBadge';
import RatePricingModal from './RatePricingModal';
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

const ToolImage = ({ tool, className = "w-full h-44", rounded = "rounded-lg" }) => {
    const toolImage = getToolImage(tool.id);
    if (tool.image_url) {
        return (
            <div className={`${className} bg-white dark:bg-gray-800 ${rounded} flex items-center justify-center shrink-0 border dark:border-gray-700 overflow-hidden`}>
                <img src={tool.image_url} alt={tool.name} loading="lazy" decoding="async" className="w-full h-full object-cover" />
            </div>
        );
    }
    if (toolImage) {
        return (
            <div className={`${className} bg-white dark:bg-gray-800 ${rounded} flex items-center justify-center shrink-0 border dark:border-gray-700 overflow-hidden`}>
                <picture className="w-full h-full">
                    <source type="image/avif" srcSet={`${getToolImage(tool.id, 256, 'avif')} 1x, ${getToolImage(tool.id, 512, 'avif')} 2x`} />
                    <source type="image/webp" srcSet={`${getToolImage(tool.id, 256, 'webp')} 1x, ${getToolImage(tool.id, 512, 'webp')} 2x`} />
                    <img src={toolImage} srcSet={`${getToolImage(tool.id, 256)} 1x, ${getToolImage(tool.id, 512)} 2x`} alt={tool.name} loading="lazy" decoding="async" width="256" height="192" className="w-full h-full object-cover" />
                </picture>
            </div>
        );
    }
    return (
        <div className={`${className} bg-gray-100 dark:bg-gray-800 ${rounded} flex items-center justify-center text-gray-400 dark:text-gray-600 shrink-0 border dark:border-gray-700`}>
            <div className="text-center p-2">
                <Icon className="fas fa-camera text-3xl mb-1 opacity-40" />
                <div className="text-[11px] font-medium">No Image</div>
            </div>
        </div>
    );
};

const ToolPendingActionsSection = ({
    toolPendingReqs = [],
    toolPendingBookings = [],
    onApproveRequest,
    onRejectRequest,
    onConfirmBooking,
    onRejectBooking
}) => {
    if (toolPendingReqs.length === 0 && toolPendingBookings.length === 0) return null;

    return (
        <div className="border border-amber-300 dark:border-amber-800/60 rounded-lg p-3 bg-amber-50/70 dark:bg-amber-900/20 space-y-3">
            <div className="font-bold text-xs uppercase tracking-wider text-amber-900 dark:text-amber-200 flex items-center gap-1.5">
                <Icon className="fas fa-bell text-amber-600 dark:text-amber-400" />
                <span>Pending Approvals ({toolPendingReqs.length + toolPendingBookings.length})</span>
            </div>

            {/* Pending Training Requests */}
            {toolPendingReqs.length > 0 && (
                <div className="space-y-2">
                    <h5 className="text-[11px] font-semibold text-gray-700 dark:text-gray-300 uppercase">
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
                    <h5 className="text-[11px] font-semibold text-gray-700 dark:text-gray-300 uppercase">
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
    );
};

const ToolGridCard = ({
    tool,
    level,
    isAdmin,
    isResponsible,
    canBook,
    pendingCount,
    toolPendingReqs,
    toolPendingBookings,
    expanded,
    onToggleExpand,
    onStatusChange,
    onBook,
    onApply,
    onApproveRequest,
    onRejectRequest,
    onConfirmBooking,
    onRejectBooking
}) => {
    return (
        <div className={`card overflow-hidden flex flex-col transition-all hover:shadow-md ${expanded ? 'ring-2 ring-blue-500/30' : ''}`}>
            {/* Card Media Header */}
            <div className="relative">
                <ToolImage tool={tool} className="w-full h-44" rounded="rounded-t-lg" />
                <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5 flex-wrap">
                    <span className="bg-white/95 dark:bg-gray-900/95 backdrop-blur-xs text-blue-700 dark:text-blue-300 font-semibold px-2 py-0.5 rounded text-xs shadow-xs">
                        {tool.category}
                    </span>
                    <RateCategoryBadge rate={tool.rate_category} />
                    <span className="bg-white/95 dark:bg-gray-900/95 backdrop-blur-xs text-gray-600 dark:text-gray-300 font-mono text-xs px-1.5 py-0.5 rounded shadow-xs">
                        #{tool.id}
                    </span>
                </div>
                <div className="absolute top-2.5 right-2.5 flex items-center gap-1.5">
                    <StatusBadge status={tool.status} />
                    {pendingCount > 0 && (
                        <span className="bg-amber-500 text-white text-[11px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 shadow-sm" title={`${pendingCount} pending items`}>
                            <Icon className="fas fa-bell text-[10px]" /> {pendingCount}
                        </span>
                    )}
                </div>
            </div>

            {/* Card Body */}
            <div className="p-4 flex-1 flex flex-col justify-between space-y-3">
                <div>
                    <div className="flex justify-between items-start gap-2">
                        <h4 className="font-bold text-gray-800 dark:text-gray-100 text-base leading-snug break-words">
                            {tool.name}
                        </h4>
                    </div>

                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 flex items-center gap-1">
                        <Icon className="fas fa-map-marker-alt text-[10px] text-gray-400" />
                        <span>{tool.location || 'Main Cleanroom'}</span>
                    </div>

                    <div className="mt-3 flex items-center justify-between">
                        <span className="text-xs text-gray-500 dark:text-gray-400">Access:</span>
                        <AccessLevelBadge level={level} licenseReq={tool.license_req} />
                    </div>

                    {/* Tool Responsible snippet */}
                    <div className="mt-2.5 pt-2.5 border-t border-gray-100 dark:border-gray-800">
                        <ToolResponsibleBadge responsible={tool.primary_responsible} />
                    </div>

                    {/* Expanded details */}
                    {expanded && (
                        <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-800 text-xs text-gray-700 dark:text-gray-300 space-y-2">
                            <p className="leading-relaxed">{tool.description || 'No description provided.'}</p>
                            {tool.secondary_responsible && (
                                <div className="pt-2 border-t border-gray-100 dark:border-gray-800">
                                    <span className="text-[10px] font-bold uppercase text-gray-400 block mb-1">Secondary Responsible</span>
                                    <ToolResponsibleBadge responsible={tool.secondary_responsible} />
                                </div>
                            )}
                        </div>
                    )}

                    {/* Pending actions */}
                    {isResponsible && (expanded || pendingCount > 0) && (
                        <div className="mt-3">
                            <ToolPendingActionsSection
                                toolPendingReqs={toolPendingReqs}
                                toolPendingBookings={toolPendingBookings}
                                onApproveRequest={onApproveRequest}
                                onRejectRequest={onRejectRequest}
                                onConfirmBooking={onConfirmBooking}
                                onRejectBooking={onRejectBooking}
                            />
                        </div>
                    )}
                </div>

                {/* Card Actions */}
                <div className="pt-3 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                        <button
                            type="button"
                            className="btn btn-secondary btn-sm py-1 px-2.5 text-xs"
                            onClick={() => onToggleExpand(tool.id)}
                            aria-expanded={expanded}
                        >
                            {expanded ? 'Less' : 'Details'}
                        </button>
                        {isAdmin && (
                            <select
                                aria-label={`Status for ${tool.name}`}
                                value={tool.status}
                                onChange={(e) => onStatusChange(tool.id, e.target.value)}
                                className="select-input text-xs py-1 px-1.5"
                            >
                                <option value="up">Up</option>
                                <option value="down">Down</option>
                                <option value="service">Service</option>
                            </select>
                        )}
                    </div>

                    <div className="flex items-center gap-1.5">
                        {canBook && (
                            <button
                                type="button"
                                onClick={() => onBook(tool)}
                                className="btn btn-primary btn-sm py-1 px-3 text-xs"
                            >
                                Book
                            </button>
                        )}
                        {!canBook && tool.license_req && level === TOOL_ACCESS_LEVELS.NONE && onApply && (
                            <button
                                type="button"
                                onClick={() => onApply(tool)}
                                className="btn btn-secondary btn-sm py-1 px-2.5 text-xs text-blue-600 dark:text-blue-400 flex items-center gap-1"
                                title="Apply for equipment training license"
                            >
                                <Icon className="fas fa-graduation-cap" />
                                Apply
                            </button>
                        )}
                        {!canBook && tool.license_req && level === TOOL_ACCESS_LEVELS.LEVEL_1 && (
                            <button
                                type="button"
                                disabled
                                className="btn btn-secondary btn-sm py-1 px-2.5 text-xs opacity-60 cursor-not-allowed text-amber-700 dark:text-amber-300"
                                title="Level I users are undergoing training and cannot book"
                            >
                                In Training
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

const ToolTable = ({
    toolsList,
    title,
    profile,
    viewMode = 'table',
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
    onRejectBooking,
    onOpenPricingModal
}) => {
    const isAdmin = profile?.access_level === 'admin';

    return (
        <div className="card mb-8">
            <div className="card-header font-bold text-gray-700 dark:text-gray-200 flex justify-between items-center">
                <span>{title} ({toolsList.length})</span>
            </div>

            {/* Mobile Card View (always card layout on small screens) */}
            <div className="lg:hidden divide-y dark:divide-gray-700">
                {toolsList.map(tool => {
                    const level = getToolAccessLevel(profile, tool.id);
                    const isResponsible = isToolResponsibleUser(tool, profile) || isAdmin;
                    const toolPendingReqs = pendingRequestsByTool[tool.id] || [];
                    const toolPendingBookings = pendingBookingsByTool[tool.id] || [];
                    const pendingCount = isResponsible ? (toolPendingReqs.length + toolPendingBookings.length) : 0;
                    const canBook = isAdmin || !tool.license_req || level === TOOL_ACCESS_LEVELS.LEVEL_2 || level === TOOL_ACCESS_LEVELS.LEVEL_3;
                    const isExpanded = expandedToolId === tool.id;

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
                                    <div className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-1.5 flex-wrap mt-0.5">
                                        <span>{tool.category}</span>
                                        <RateCategoryBadge rate={tool.rate_category} size="xs" />
                                        <span>· ID {tool.id} {tool.location ? `· ${tool.location}` : ''}</span>
                                    </div>
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

                            {/* Pending Actions Section on Mobile (Fixing previous mobile bug where responsibles couldn't approve/reject) */}
                            {isResponsible && (isExpanded || pendingCount > 0) && (
                                <ToolPendingActionsSection
                                    toolPendingReqs={toolPendingReqs}
                                    toolPendingBookings={toolPendingBookings}
                                    onApproveRequest={onApproveRequest}
                                    onRejectRequest={onRejectRequest}
                                    onConfirmBooking={onConfirmBooking}
                                    onRejectBooking={onRejectBooking}
                                />
                            )}

                            {isExpanded && (
                                <div className="space-y-3 pt-2">
                                    <ToolImage tool={tool} className="w-full h-44" rounded="rounded-lg" />
                                    <p className="text-sm text-gray-700 dark:text-gray-300 break-words">
                                        {tool.description || 'No description provided.'}
                                    </p>
                                    {tool.secondary_responsible && (
                                        <div className="bg-gray-50 dark:bg-gray-900/40 p-2.5 rounded-lg border dark:border-gray-700">
                                            <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400 block mb-1">Secondary Responsible</span>
                                            <ToolResponsibleBadge responsible={tool.secondary_responsible} />
                                        </div>
                                    )}
                                </div>
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
                                    className="btn btn-secondary btn-sm min-h-[38px] px-3"
                                    onClick={() => onToggleExpand(tool.id)}
                                    aria-expanded={isExpanded}
                                >
                                    {isExpanded ? 'Hide details' : 'Details'}
                                </button>

                                {canBook && (
                                    <button
                                        type="button"
                                        className="btn btn-primary btn-sm min-h-[38px] px-4 font-semibold"
                                        onClick={() => onBook(tool)}
                                    >
                                        View availability / Book
                                    </button>
                                )}

                                {!canBook && tool.license_req && level === TOOL_ACCESS_LEVELS.NONE && onApply && (
                                    <button
                                        type="button"
                                        className="btn btn-secondary btn-sm min-h-[38px] text-blue-600 dark:text-blue-400 flex items-center gap-1.5"
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
                                        className="btn btn-secondary btn-sm min-h-[38px] opacity-60 cursor-not-allowed text-amber-700 dark:text-amber-300"
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

            {/* Desktop Grid View (Visible when viewMode === 'grid') */}
            {viewMode === 'grid' && (
                <div className="hidden lg:grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 p-4">
                    {toolsList.map(tool => {
                        const level = getToolAccessLevel(profile, tool.id);
                        const isResponsible = isToolResponsibleUser(tool, profile) || isAdmin;
                        const toolPendingReqs = pendingRequestsByTool[tool.id] || [];
                        const toolPendingBookings = pendingBookingsByTool[tool.id] || [];
                        const pendingCount = isResponsible ? (toolPendingReqs.length + toolPendingBookings.length) : 0;
                        const canBook = isAdmin || !tool.license_req || level === TOOL_ACCESS_LEVELS.LEVEL_2 || level === TOOL_ACCESS_LEVELS.LEVEL_3;

                        return (
                            <ToolGridCard
                                key={tool.id}
                                tool={tool}
                                level={level}
                                isAdmin={isAdmin}
                                isResponsible={isResponsible}
                                canBook={canBook}
                                pendingCount={pendingCount}
                                toolPendingReqs={toolPendingReqs}
                                toolPendingBookings={toolPendingBookings}
                                expanded={expandedToolId === tool.id}
                                onToggleExpand={onToggleExpand}
                                onStatusChange={onStatusChange}
                                onBook={onBook}
                                onApply={onApply}
                                onApproveRequest={onApproveRequest}
                                onRejectRequest={onRejectRequest}
                                onConfirmBooking={onConfirmBooking}
                                onRejectBooking={onRejectBooking}
                            />
                        );
                    })}
                </div>
            )}

            {/* Desktop Table View (Visible when viewMode === 'table') */}
            {viewMode === 'table' && (
                <table className="hidden lg:table w-full text-left border-collapse">
                    <thead className="bg-gray-50 dark:bg-gray-900 border-b dark:border-gray-700 transition-colors">
                        <tr>
                            <th className="p-3 font-semibold text-gray-600 dark:text-gray-300">ID</th>
                            <th className="p-3 font-semibold text-gray-600 dark:text-gray-300">Equipment</th>
                            <th className="p-3 font-semibold text-gray-600 dark:text-gray-300">Category & Rate</th>
                            <th className="p-3 font-semibold text-gray-600 dark:text-gray-300">Tool Responsible</th>
                            <th className="p-3 font-semibold text-gray-600 dark:text-gray-300">Status</th>
                            <th className="p-3 font-semibold text-gray-600 dark:text-gray-300">Access Level</th>
                            <th className="p-3 font-semibold text-gray-600 dark:text-gray-300 text-right">Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        {toolsList.map(tool => {
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
                                                    className="font-bold text-left text-gray-800 dark:text-gray-200 hover:underline cursor-pointer"
                                                >
                                                    {tool.name} <span className="sr-only">details</span>
                                                </button>
                                                {pendingCount > 0 && (
                                                    <button
                                                        type="button"
                                                        className="bg-amber-500 text-white text-[11px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 shadow-sm cursor-pointer"
                                                        onClick={() => onToggleExpand(tool.id)}
                                                        title={`${pendingCount} pending items for ${tool.name}`}
                                                    >
                                                        <Icon className="fas fa-bell text-[10px]" /> {pendingCount}
                                                    </button>
                                                )}
                                            </div>
                                        </td>
                                        <td className="p-3">
                                            <div className="flex items-center gap-1.5 flex-wrap">
                                                <span className="bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-2 py-1 rounded text-xs font-semibold">
                                                    {tool.category}
                                                </span>
                                                <RateCategoryBadge rate={tool.rate_category} />
                                            </div>
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
                                                    {/* Tool Image */}
                                                    <ToolImage tool={tool} className="w-full md:w-64 h-48" rounded="rounded-lg" />

                                                    {/* Details & Responsible Information */}
                                                    <div className="flex-1 space-y-4">
                                                        <div>
                                                            <h4 className="font-bold text-lg text-gray-800 dark:text-gray-200 mb-1">{tool.name}</h4>
                                                            <p className="text-gray-700 dark:text-gray-300 text-sm leading-relaxed">
                                                                {tool.description || 'No description provided.'}
                                                            </p>
                                                        </div>

                                                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                                                            <div>
                                                                <div className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Category</div>
                                                                <div className="text-sm text-gray-800 dark:text-gray-200 font-medium">{tool.category}</div>
                                                            </div>
                                                            <div>
                                                                <div className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1 flex items-center justify-between">
                                                                    <span>Rate Category</span>
                                                                    {onOpenPricingModal && (
                                                                        <button
                                                                            type="button"
                                                                            onClick={onOpenPricingModal}
                                                                            className="text-[10px] text-blue-600 dark:text-blue-400 hover:underline cursor-pointer font-normal normal-case flex items-center gap-0.5"
                                                                        >
                                                                            <Icon className="fas fa-info-circle text-[9px]" /> rates
                                                                        </button>
                                                                    )}
                                                                </div>
                                                                <div className="text-sm text-gray-800 dark:text-gray-200 font-medium flex items-center gap-1.5">
                                                                    <RateCategoryBadge rate={tool.rate_category} />
                                                                </div>
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
                                                            <ToolPendingActionsSection
                                                                toolPendingReqs={toolPendingReqs}
                                                                toolPendingBookings={toolPendingBookings}
                                                                onApproveRequest={onApproveRequest}
                                                                onRejectRequest={onRejectRequest}
                                                                onConfirmBooking={onConfirmBooking}
                                                                onRejectBooking={onRejectBooking}
                                                            />
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
            )}

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
    const [filterRateCategory, setFilterRateCategory] = useState('All');
    const [isPricingModalOpen, setIsPricingModalOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [expandedToolId, setExpandedToolId] = useState(null);
    const [viewMode, setViewMode] = useState(() => {
        try {
            return localStorage.getItem('mmi_equipment_view') || 'table';
        } catch {
            return 'table';
        }
    });

    const handleViewModeChange = (mode) => {
        setViewMode(mode);
        try {
            localStorage.setItem('mmi_equipment_view', mode);
        } catch {
            // ignore
        }
    };

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
        const matchesRate = filterRateCategory === 'All' || (t.rate_category || 'A') === filterRateCategory;
        const matchesSearch = t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            t.id.toString().includes(searchQuery) ||
            (t.description && t.description.toLowerCase().includes(searchQuery.toLowerCase()));
        return matchesCategory && matchesRate && matchesSearch;
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
            {/* Filter and Control Bar */}
            <div className="card p-4 space-y-3">
                <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
                    <div className="flex-1 relative">
                        <input
                            aria-label="Search equipment"
                            type="text"
                            placeholder="Search equipment name, ID, or description..."
                            className="input-field pl-9"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                        <Icon className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm" />
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                        {/* Desktop View Mode Toggle (Grid vs Table) */}
                        <div className="hidden md:inline-flex items-center rounded-lg border border-gray-200 dark:border-gray-700 p-0.5 bg-gray-50 dark:bg-gray-900">
                            <button
                                type="button"
                                onClick={() => handleViewModeChange('table')}
                                className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5 cursor-pointer ${
                                    viewMode === 'table'
                                        ? 'bg-white dark:bg-gray-800 text-blue-600 dark:text-blue-400 shadow-xs font-semibold'
                                        : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                                }`}
                                title="Table View"
                            >
                                <Icon className="fas fa-list" />
                                <span>Table</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => handleViewModeChange('grid')}
                                className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5 cursor-pointer ${
                                    viewMode === 'grid'
                                        ? 'bg-white dark:bg-gray-800 text-blue-600 dark:text-blue-400 shadow-xs font-semibold'
                                        : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                                }`}
                                title="Grid View"
                            >
                                <Icon className="fas fa-th-large" />
                                <span>Grid</span>
                            </button>
                        </div>

                        {profile?.access_level === 'admin' && onOpenAddModal && (
                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    onClick={() => onOpenAddModal('single')}
                                    className="btn btn-primary btn-sm flex items-center gap-1.5 whitespace-nowrap min-h-[36px]"
                                >
                                    <Icon className="fas fa-plus" />
                                    Add Equipment
                                </button>
                                <button
                                    type="button"
                                    onClick={() => onOpenAddModal('bulk')}
                                    className="btn btn-secondary btn-sm flex items-center gap-1.5 whitespace-nowrap min-h-[36px]"
                                    title="Import equipment from CSV file"
                                >
                                    <Icon className="fas fa-file-csv" />
                                    Import CSV
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                {/* Horizontal Category Filter Chips */}
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-thin">
                    {categories.map(c => {
                        const count = c === 'All'
                            ? tools.length
                            : tools.filter(t => t.category === c).length;
                        const isSelected = filterCategory === c;
                        return (
                            <button
                                key={c}
                                type="button"
                                onClick={() => setFilterCategory(c)}
                                className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors flex items-center gap-1.5 shrink-0 cursor-pointer ${
                                    isSelected
                                        ? 'bg-blue-600 text-white shadow-xs'
                                        : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                                }`}
                            >
                                <span>{c}</span>
                                <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${isSelected ? 'bg-blue-500 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300'}`}>
                                    {count}
                                </span>
                            </button>
                        );
                    })}
                </div>

                {/* Horizontal Rate Category Filter Chips & Guide Button */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-t dark:border-gray-700/60 pt-2.5">
                    <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-thin">
                        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 mr-1 shrink-0">Rate:</span>
                        {['All', 'A', 'B', 'C', 'D'].map(rate => {
                            const count = rate === 'All'
                                ? (filterCategory === 'All' ? tools.length : tools.filter(t => t.category === filterCategory).length)
                                : (filterCategory === 'All'
                                    ? tools.filter(t => (t.rate_category || 'A') === rate).length
                                    : tools.filter(t => t.category === filterCategory && (t.rate_category || 'A') === rate).length);
                            const isSelected = filterRateCategory === rate;
                            return (
                                <button
                                    key={rate}
                                    type="button"
                                    onClick={() => setFilterRateCategory(rate)}
                                    className={`px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors flex items-center gap-1.5 shrink-0 cursor-pointer ${
                                        isSelected
                                            ? 'bg-blue-600 text-white shadow-xs'
                                            : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                                    }`}
                                >
                                    <span>{rate === 'All' ? 'All Rates' : `Rate ${rate}`}</span>
                                    <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${isSelected ? 'bg-blue-500 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300'}`}>
                                        {count}
                                    </span>
                                </button>
                            );
                        })}
                    </div>

                    <button
                        type="button"
                        onClick={() => setIsPricingModalOpen(true)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition shrink-0 cursor-pointer shadow-xs"
                        title="View official equipment hourly rate table for External, KTU, and MMI Department users"
                    >
                        <Icon className="fas fa-table text-blue-600 dark:text-blue-400" />
                        <span>Rates & Access Modes</span>
                    </button>
                </div>
            </div>

            <ToolTable
                toolsList={authorizedTools}
                title="My Authorized Equipment"
                profile={profile}
                viewMode={viewMode}
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
                onOpenPricingModal={() => setIsPricingModalOpen(true)}
            />

            {trainingTools.length > 0 && (
                <ToolTable
                    toolsList={trainingTools}
                    title="Equipment In Training (Level I)"
                    profile={profile}
                    viewMode={viewMode}
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
                    onOpenPricingModal={() => setIsPricingModalOpen(true)}
                />
            )}

            {otherTools.length > 0 && (
                <ToolTable
                    toolsList={otherTools}
                    title="Other Available Equipment"
                    profile={profile}
                    viewMode={viewMode}
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
                    onOpenPricingModal={() => setIsPricingModalOpen(true)}
                />
            )}

            {/* Rate & Pricing Guide Modal */}
            <RatePricingModal
                isOpen={isPricingModalOpen}
                onClose={() => setIsPricingModalOpen(false)}
            />
        </div>
    );
};

export default ToolList;
