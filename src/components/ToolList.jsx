import React, { useState, useMemo } from 'react';
import StatusBadge from './StatusBadge';

const toolImages = import.meta.glob('../assets/tool_images/*.{jpg,png,svg}', { eager: true, import: 'default' });

const getToolImage = (id) => {
    // Try to find an image with the ID as the filename
    const imagePath = Object.keys(toolImages).find(path => {
        const fileName = path.split('/').pop().split('.')[0];
        return fileName === String(id);
    });
    return imagePath ? toolImages[imagePath] : null;
};

const ToolTable = ({ toolsList, title, profile, onStatusChange, onBook, expandedToolId, onToggleExpand }) => (
    <div className="card mb-8">
        <div className="card-header font-bold text-gray-700 dark:text-gray-200">{title} ({toolsList.length})</div>
        <table className="w-full text-left border-collapse">
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
                            <tr
                                onClick={() => onToggleExpand(tool.id)}
                                className={`tool-row border-b dark:border-gray-700 last:border-0 transition-colors cursor-pointer hover:bg-blue-50/50 dark:hover:bg-blue-900/10 ${expandedToolId === tool.id ? 'bg-blue-50/30 dark:bg-blue-900/5' : ''}`}
                            >
                                <td className="p-3 text-gray-500 dark:text-gray-400 font-mono text-sm">{tool.id}</td>
                                <td className="p-3">
                                    <div className="font-bold text-gray-800 dark:text-gray-200">{tool.name}</div>
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
                                        <span className="text-green-700 dark:text-green-400 font-bold flex items-center gap-1 text-sm"><i className="fas fa-check-circle"></i> Active</span>
                                    ) : (
                                        <span className="text-gray-400 dark:text-gray-500 flex items-center gap-1 text-sm"><i className="fas fa-times-circle"></i> Missing</span>
                                    )}
                                </td>
                                <td className="p-3 text-right">
                                    <button
                                        onClick={(e) => { e.stopPropagation(); onBook(tool); }}
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
                                            {toolImage ? (
                                                <div className="w-full md:w-64 h-48 bg-white dark:bg-gray-800 rounded-lg flex items-center justify-center shrink-0 border dark:border-gray-700 overflow-hidden">
                                                    <img
                                                        src={toolImage}
                                                        alt={tool.name}
                                                        className="w-full h-full object-cover"
                                                    />
                                                </div>
                                            ) : (
                                                <div className="w-full md:w-64 h-48 bg-gray-200 dark:bg-gray-800 rounded-lg flex items-center justify-center text-gray-400 dark:text-gray-600 shrink-0 border dark:border-gray-700">
                                                    <div className="text-center">
                                                        <i className="fas fa-camera text-4xl mb-2"></i>
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

const ToolList = ({ tools, profile, onStatusChange, onBook }) => {
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

    const authorizedTools = filteredTools.filter(t => !t.license_req || profile?.licenses?.includes(t.id));
    const otherTools = filteredTools.filter(t => t.license_req && !profile?.licenses?.includes(t.id));

    return (
        <div className="space-y-4">
            <div className="flex flex-col md:flex-row gap-4 card p-4">
                <div className="flex-1">
                    <input
                        type="text"
                        placeholder="Search tool name, ID, or description..."
                        className="input-field"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </div>
                <select
                    className="select-input"
                    value={filterCategory}
                    onChange={(e) => setFilterCategory(e.target.value)}
                >
                    {categories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
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
