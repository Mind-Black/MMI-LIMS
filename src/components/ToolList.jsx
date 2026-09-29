import React, { useState, useMemo } from 'react';
import Icon from './Icon';
import StatusBadge from './StatusBadge';

const toolImages = import.meta.glob('../assets/tool_thumbnails/*.{jpg,webp,avif}', { eager: true, import: 'default' });

const getToolImage = (id, width = 256, extension = 'jpg') =>
    toolImages[`../assets/tool_thumbnails/${id}-${width}.${extension}`] || null;

const ToolTable = ({ toolsList, title, profile, onStatusChange, onBook, expandedToolId, onToggleExpand }) => (
    <div className="card mb-8">
        <div className="card-header font-bold text-gray-700 dark:text-gray-200">{title} ({toolsList.length})</div>
        <div className="lg:hidden divide-y dark:divide-gray-700">
            {toolsList.map(tool => (
                <article key={tool.id} className="p-4 min-w-0 space-y-3">
                    <div className="flex justify-between gap-3 items-start">
                        <div className="min-w-0">
                            <h4 className="font-bold text-gray-800 dark:text-gray-100 break-words">{tool.name}</h4>
                            <p className="text-sm text-gray-500 dark:text-gray-400">{tool.category} · ID {tool.id}</p>
                        </div>
                        <StatusBadge status={tool.status} />
                    </div>
                    <p className="text-sm text-gray-700 dark:text-gray-300">
                        Authorization: {!tool.license_req ? 'No license required' : profile?.licenses?.includes(tool.id) ? 'Licensed' : 'License required'}
                    </p>
                    {expandedToolId === tool.id && <p className="text-sm text-gray-700 dark:text-gray-300 break-words">{tool.description || 'No description provided.'}</p>}
                    {profile?.access_level === 'admin' && (
                        <label className="block text-sm text-gray-700 dark:text-gray-300">Equipment status
                            <select aria-label={`Status for ${tool.name}`} value={tool.status} onChange={e => onStatusChange(tool.id, e.target.value)} className="select-input ml-2 text-sm">
                                <option value="up">Available</option><option value="down">Unavailable</option><option value="service">Under maintenance</option>
                            </select>
                        </label>
                    )}
                    <div className="flex flex-wrap gap-2">
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => onToggleExpand(tool.id)} aria-expanded={expandedToolId === tool.id}>
                            {expandedToolId === tool.id ? 'Hide details' : 'Details'}
                        </button>
                        <button type="button" className="btn btn-primary btn-sm" onClick={() => onBook(tool)}>View availability / Book</button>
                    </div>
                </article>
            ))}
        </div>
        <table className="hidden lg:table w-full text-left border-collapse">
            <thead className="bg-gray-50 dark:bg-gray-900 border-b dark:border-gray-700 transition-colors">
                <tr>
                    <th className="p-3 font-semibold text-gray-600 dark:text-gray-300">ID</th>
                    <th className="p-3 font-semibold text-gray-600 dark:text-gray-300">Name</th>
                    <th className="p-3 font-semibold text-gray-600 dark:text-gray-300">Category</th>
                    <th className="p-3 font-semibold text-gray-600 dark:text-gray-300">Status</th>
                    <th className="p-3 font-semibold text-gray-600 dark:text-gray-300">License</th>
                    <th className="p-3 font-semibold text-gray-600 dark:text-gray-300 text-right">Action</th>
                </tr>
            </thead>
            <tbody>
                {toolsList.map(tool => {
                    const toolImage = getToolImage(tool.id);
                    return (
                        <React.Fragment key={tool.id}>
                            <tr className={`tool-row border-b dark:border-gray-700 last:border-0 transition-colors hover:bg-blue-50/50 dark:hover:bg-blue-900/10 ${expandedToolId === tool.id ? 'bg-blue-50/30 dark:bg-blue-900/5' : ''}`}>
                                <td className="p-3 text-gray-500 dark:text-gray-400 font-mono text-sm">{tool.id}</td>
                                <td className="p-3">
                                    <button type="button" onClick={() => onToggleExpand(tool.id)} aria-expanded={expandedToolId === tool.id} className="font-bold text-left text-gray-800 dark:text-gray-200 hover:underline">{tool.name} <span className="sr-only">details</span></button>
                                </td>
                                <td className="p-3">
                                    <span className="bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-2 py-1 rounded text-xs font-semibold">
                                        {tool.category}
                                    </span>
                                </td>
                                <td className="p-3">
                                    <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                                        <StatusBadge status={tool.status} />
                                        {profile?.access_level === 'admin' && (
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
                                    {!tool.license_req ? (
                                        <span className="text-green-600 dark:text-green-400 text-xs font-bold bg-green-50 dark:bg-green-900/20 px-2 py-1 rounded">Not Required</span>
                                    ) : profile?.licenses?.includes(tool.id) ? (
                                        <span className="text-green-700 dark:text-green-400 font-bold flex items-center gap-1 text-sm"><Icon className="fas fa-check-circle" /> Active</span>
                                    ) : (
                                        <span className="text-gray-400 dark:text-gray-500 flex items-center gap-1 text-sm"><Icon className="fas fa-times-circle" /> Missing</span>
                                    )}
                                </td>
                                <td className="p-3 text-right">
                                    <button
                                        onClick={() => onBook(tool)}
                                        className="btn btn-primary btn-sm"
                                    >
                                        Book
                                    </button>
                                </td>
                            </tr>
                            {expandedToolId === tool.id && (
                                <tr className="bg-gray-50 dark:bg-gray-900/50 border-b dark:border-gray-700">
                                    <td colSpan="6" className="p-6">
                                        <div className="flex flex-col md:flex-row gap-6 animate-fadeIn">
                                            {/* Image or Placeholder */}
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

                                            {/* Details */}
                                            <div className="flex-1">
                                                <h4 className="font-bold text-lg text-gray-800 dark:text-gray-200 mb-2">{tool.name}</h4>

                                                <div className="space-y-4">
                                                    <div>
                                                        <div className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Description</div>
                                                        <p className="text-gray-700 dark:text-gray-300 text-sm leading-relaxed">
                                                            {tool.description || "No description provided."}
                                                        </p>
                                                    </div>

                                                    <div className="grid grid-cols-2 gap-4">
                                                        <div>
                                                            <div className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Category</div>
                                                            <div className="text-sm text-gray-800 dark:text-gray-200 font-medium">{tool.category}</div>
                                                        </div>
                                                        <div>
                                                            <div className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">System ID</div>
                                                            <div className="text-sm font-mono text-gray-800 dark:text-gray-200">{tool.id}</div>
                                                        </div>
                                                    </div>
                                                </div>
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

const ToolList = ({ tools, profile, onStatusChange, onBook, onOpenAddModal }) => {
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

    const filteredTools = tools.filter(t => {
        const matchesCategory = filterCategory === 'All' || t.category === filterCategory;
        const matchesSearch = t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            t.id.toString().includes(searchQuery) ||
            (t.description && t.description.toLowerCase().includes(searchQuery.toLowerCase()));
        return matchesCategory && matchesSearch;
    });

    const isAuthorized = (t) => profile?.access_level === 'admin' || !t.license_req || (Array.isArray(profile?.licenses) && profile.licenses.includes(t.id));
    const authorizedTools = filteredTools.filter(isAuthorized);
    const otherTools = filteredTools.filter(t => !isAuthorized(t));

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
                title="My Authorized Tools"
                profile={profile}
                onStatusChange={onStatusChange}
                onBook={onBook}
                expandedToolId={expandedToolId}
                onToggleExpand={handleToggleExpand}
            />
            <ToolTable
                toolsList={otherTools}
                title="Other Tools"
                profile={profile}
                onStatusChange={onStatusChange}
                onBook={onBook}
                expandedToolId={expandedToolId}
                onToggleExpand={handleToggleExpand}
            />
        </div>
    );
};

export default ToolList;
