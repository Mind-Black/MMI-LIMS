import React, { useState, useMemo } from 'react';
import StatusBadge from './StatusBadge';

const ToolTable = ({ toolsList, title, profile, onStatusChange, onBook }) => (
    <div className="bg-white dark:bg-gray-800 rounded shadow-sm overflow-x-auto border dark:border-gray-700 mb-8 transition-colors">
        <div className="p-4 bg-gray-50 dark:bg-gray-900 border-b dark:border-gray-700 font-bold text-gray-700 dark:text-gray-200 transition-colors">{title} ({toolsList.length})</div>
        <table className="w-full text-left border-collapse">
            <thead className="bg-gray-50 dark:bg-gray-900 border-b dark:border-gray-700 transition-colors">
                <tr>
                    <th className="p-4 font-semibold text-gray-600 dark:text-gray-300">ID</th>
                    <th className="p-4 font-semibold text-gray-600 dark:text-gray-300">Name</th>
                    <th className="p-4 font-semibold text-gray-600 dark:text-gray-300">Category</th>
                    <th className="p-4 font-semibold text-gray-600 dark:text-gray-300">Status</th>
                    <th className="p-4 font-semibold text-gray-600 dark:text-gray-300">License</th>
                    <th className="p-4 font-semibold text-gray-600 dark:text-gray-300 text-right">Action</th>
                </tr>
            </thead>
            <tbody>
                {toolsList.map(tool => (
                    <tr key={tool.id} className="tool-row border-b dark:border-gray-700 last:border-0 transition-colors">
                        <td className="p-4 text-gray-500 dark:text-gray-400 font-mono text-sm">{tool.id}</td>
                        <td className="p-4">
                            <div className="font-bold text-gray-800 dark:text-gray-200">{tool.name}</div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">{tool.description}</div>
                        </td>
                        <td className="p-4">
                            <span className="bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-2 py-1 rounded text-xs font-semibold">
                                {tool.category}
                            </span>
                        </td>
                        <td className="p-4">
                            <div className="flex items-center gap-2">
                                <StatusBadge status={tool.status} />
                                {profile?.access_level === 'admin' && (
                                    <select
                                        value={tool.status}
                                        onChange={(e) => onStatusChange(tool.id, e.target.value)}
                                        className="text-xs border dark:border-gray-600 rounded p-1 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200"
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
                                <span className="text-green-600 dark:text-green-400 text-xs font-bold bg-green-50 dark:bg-green-900/20 px-2 py-1 rounded">Not Required</span>
                            ) : profile?.licenses?.includes(tool.id) ? (
                                <span className="text-green-700 dark:text-green-400 font-bold flex items-center gap-1 text-sm"><i className="fas fa-check-circle"></i> Active</span>
                            ) : (
                                <span className="text-gray-400 dark:text-gray-500 flex items-center gap-1 text-sm"><i className="fas fa-times-circle"></i> Missing</span>
                            )}
                        </td>
                        <td className="p-4 text-right">
                            <button
                                onClick={() => onBook(tool)}
                                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded text-sm font-medium shadow-sm transition-colors"
                            >
                                Book
                            </button>
                        </td>
                    </tr>
                ))}
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

    return (
        <div className="space-y-4">
            <div className="flex flex-col md:flex-row gap-4 bg-white dark:bg-gray-800 p-4 rounded shadow-sm transition-colors">
                <div className="flex-1">
                    <input
                        type="text"
                        placeholder="Search tool name or ID..."
                        className="w-full border dark:border-gray-600 p-2 rounded focus:ring-2 focus:ring-blue-500 outline-none bg-white dark:bg-gray-700 text-gray-800 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 transition-colors"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </div>
                <select
                    className="border dark:border-gray-600 p-2 rounded bg-white dark:bg-gray-700 text-gray-800 dark:text-white transition-colors"
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
            />
            <ToolTable
                toolsList={otherTools}
                title="Other Tools"
                profile={profile}
                onStatusChange={onStatusChange}
                onBook={onBook}
            />
        </div>
    );
};

export default ToolList;
