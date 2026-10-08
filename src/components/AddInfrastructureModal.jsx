import React, { useState, useEffect, useRef, useMemo } from 'react';
import Icon from './Icon';
import { supabase } from '../supabaseClient';
import { useToast } from '../context/useToast';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { downloadInfrastructureCsvTemplate, parseInfrastructureCsv } from '../utils/csvHelper';
import StatusBadge from './StatusBadge';
import RateCategoryBadge from './RateCategoryBadge';
import RatePricingModal from './RatePricingModal';

const AddInfrastructureModal = ({
    isOpen,
    onClose,
    onSuccess,
    existingTools = [],
    defaultMode = 'single'
}) => {
    const [mode, setMode] = useState(defaultMode); // 'single' | 'bulk'
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isPricingModalOpen, setIsPricingModalOpen] = useState(false);
    const { showToast } = useToast();
    const [availableUsers, setAvailableUsers] = useState([]);

    // Dialog Focus Trap & Escape handler
    const dialogRef = useDialogFocus(isOpen, onClose);

    // Categories and locations extracted from existing tools for suggestions
    const existingCategories = useMemo(() => {
        const set = new Set(existingTools.map(t => t.category).filter(Boolean));
        return Array.from(set).sort();
    }, [existingTools]);

    const existingLocations = useMemo(() => {
        const set = new Set(existingTools.map(t => t.location).filter(Boolean));
        return Array.from(set).sort();
    }, [existingTools]);

    // --- Single Item Form State ---
    const [formData, setFormData] = useState({
        name: '',
        category: '',
        customCategory: '',
        rate_category: 'A',
        location: '',
        status: 'up',
        license_req: true,
        image_url: '',
        description: '',
        primary_responsible_id: '',
        secondary_responsible_id: ''
    });
    const [formErrors, setFormErrors] = useState({});

    // Fetch users for Tool Responsible selection
    useEffect(() => {
        const fetchUsers = async () => {
            try {
                const { data, error } = await supabase
                    .from('profiles')
                    .select('id, first_name, last_name, email, phone, job_title, access_level')
                    .order('last_name');
                if (!error && data) {
                    setAvailableUsers(data);
                    // Default primary responsible to the first admin user
                    const defaultAdmin = data.find(u => u.access_level === 'admin');
                    if (defaultAdmin) {
                        setFormData(prev => ({
                            ...prev,
                            primary_responsible_id: prev.primary_responsible_id || defaultAdmin.id
                        }));
                    }
                }
            } catch (err) {
                console.error('Error fetching users for tool responsible:', err);
            }
        };
        fetchUsers();
    }, []);

    // --- Bulk CSV State ---
    const [csvFile, setCsvFile] = useState(null);
    const [csvParsed, setCsvParsed] = useState(null);
    const [csvFileError, setCsvFileError] = useState('');
    const fileInputRef = useRef(null);

    if (!isOpen) return null;

    // Handle single form input changes
    const handleInputChange = (field, value) => {
        setFormData(prev => ({ ...prev, [field]: value }));
        if (formErrors[field]) {
            setFormErrors(prev => ({ ...prev, [field]: '' }));
        }
    };

    // Validate single form
    const validateSingleForm = () => {
        const errors = {};
        const name = formData.name.trim();
        const category = formData.category === '__custom__'
            ? formData.customCategory.trim()
            : formData.category.trim();

        if (!name) {
            errors.name = 'Equipment name is required.';
        } else if (name.length < 2) {
            errors.name = 'Name must be at least 2 characters.';
        } else if (name.length > 100) {
            errors.name = 'Name cannot exceed 100 characters.';
        }

        if (!category) {
            errors.category = 'Category is required.';
        }

        if (formData.image_url) {
            const url = formData.image_url.trim();
            if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('/')) {
                errors.image_url = 'Image URL must begin with http://, https://, or /';
            }
        }

        setFormErrors(errors);
        return Object.keys(errors).length === 0;
    };

    // Submit single infrastructure item
    const handleSingleSubmit = async (e) => {
        e.preventDefault();
        if (!validateSingleForm()) return;

        setIsSubmitting(true);
        const resolvedCategory = formData.category === '__custom__'
            ? formData.customCategory.trim()
            : formData.category.trim();

        const payload = {
            name: formData.name.trim(),
            category: resolvedCategory,
            rate_category: formData.rate_category || 'A',
            location: formData.location.trim() || null,
            status: formData.status,
            license_req: Boolean(formData.license_req),
            description: formData.description.trim() || null,
            image_url: formData.image_url.trim() || null,
            primary_responsible_id: formData.primary_responsible_id || null,
            secondary_responsible_id: formData.secondary_responsible_id || null
        };

        try {
            // Attempt insertion with responsible IDs, rate_category, and image_url
            let { data, error } = await supabase
                .from('tools')
                .insert([payload])
                .select('id, name, category, rate_category, status, location, license_req, description, image_url, primary_responsible_id, secondary_responsible_id')
                .single();

            // Backward compatibility fallback: if new columns don't exist yet on DB
            if (error && error.message) {
                const legacyPayload = { ...payload };
                delete legacyPayload.primary_responsible_id;
                delete legacyPayload.secondary_responsible_id;
                delete legacyPayload.image_url;
                delete legacyPayload.rate_category;
                const retry = await supabase
                    .from('tools')
                    .insert([legacyPayload])
                    .select('id, name, category, status, location, license_req, description')
                    .single();
                data = retry.data;
                error = retry.error;
            }

            if (error) throw error;

            const primaryUser = availableUsers.find(u => u.id === data.primary_responsible_id) || null;
            const secondaryUser = availableUsers.find(u => u.id === data.secondary_responsible_id) || null;
            const enrichedData = {
                ...data,
                primary_responsible: primaryUser,
                secondary_responsible: secondaryUser
            };

            showToast(`Equipment "${data.name}" successfully created!`, 'success');
            if (onSuccess) {
                onSuccess(enrichedData);
            }
            onClose();
        } catch (err) {
            console.error('Error creating infrastructure:', err);
            showToast('Failed to add equipment: ' + (err.message || 'Unknown error'), 'error');
        } finally {
            setIsSubmitting(false);
        }
    };

    // Handle CSV file selection
    const handleFileChange = (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setCsvFileError('');
        if (!file.name.toLowerCase().endsWith('.csv') && file.type !== 'text/csv') {
            setCsvFileError('Please select a valid .csv file.');
            return;
        }

        setCsvFile(file);
        const reader = new FileReader();
        reader.onload = (event) => {
            const text = event.target?.result;
            if (typeof text === 'string') {
                const parsed = parseInfrastructureCsv(text, existingTools);
                setCsvParsed(parsed);
                if (parsed.error) {
                    setCsvFileError(parsed.error);
                }
            }
        };
        reader.onerror = () => {
            setCsvFileError('Failed to read file.');
        };
        reader.readAsText(file);
    };

    // Clear CSV upload
    const handleClearCsv = () => {
        setCsvFile(null);
        setCsvParsed(null);
        setCsvFileError('');
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    // Submit bulk CSV import
    const handleBulkSubmit = async () => {
        if (!csvParsed) {
            showToast('Please select a CSV file first.', 'warning');
            return;
        }

        const rowsToInsert = csvParsed.newRows && csvParsed.newRows.length !== undefined
            ? csvParsed.newRows
            : (csvParsed.validRows || []);

        if (rowsToInsert.length === 0) {
            if (csvParsed.existingRows && csvParsed.existingRows.length > 0) {
                showToast(`All ${csvParsed.existingRows.length} tool(s) in this file already exist in the database. Nothing was imported to prevent duplicates.`, 'info');
            } else {
                showToast('No valid equipment rows to import.', 'warning');
            }
            return;
        }

        setIsSubmitting(true);
        const validRows = rowsToInsert;

        try {
            let { data, error } = await supabase
                .from('tools')
                .insert(validRows)
                .select('id, name, category, rate_category, status, location, license_req, description, image_url');

            // Fallback if rate_category or image_url column not yet applied on target DB
            if (error && error.message && (error.message.includes('image_url') || error.message.includes('rate_category'))) {
                const legacyRows = validRows.map(r => {
                    const rowCopy = { ...r };
                    delete rowCopy.image_url;
                    delete rowCopy.rate_category;
                    return rowCopy;
                });
                const retry = await supabase
                    .from('tools')
                    .insert(legacyRows)
                    .select('id, name, category, status, location, license_req, description');
                data = retry.data;
                error = retry.error;
            }

            if (error) throw error;

            const protectedCount = csvParsed.existingRows?.length || 0;
            const successMsg = protectedCount > 0
                ? `Successfully imported ${data.length} new equipment item(s)! (${protectedCount} existing tool(s) were protected and skipped)`
                : `Successfully imported ${data.length} equipment item(s)!`;
            showToast(successMsg, 'success');
            if (onSuccess) {
                onSuccess(data);
            }
            onClose();
        } catch (err) {
            console.error('Error importing CSV infrastructure:', err);
            showToast('Failed to import CSV: ' + (err.message || 'Unknown error'), 'error');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 overflow-y-auto">
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="add-infra-title"
                tabIndex={-1}
                className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-2xl w-full p-6 space-y-5 my-8 transition-colors border dark:border-gray-700"
            >
                {/* Header */}
                <div className="flex justify-between items-center border-b dark:border-gray-700 pb-3">
                    <div className="flex items-center gap-2">
                        <Icon className="fas fa-server text-blue-600 dark:text-blue-400 text-xl" />
                        <h3 id="add-infra-title" className="text-xl font-bold text-gray-900 dark:text-gray-100">
                            Add Laboratory Infrastructure
                        </h3>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close dialog"
                        className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1 rounded-lg"
                    >
                        <Icon className="fas fa-times text-lg" />
                    </button>
                </div>

                {/* Modality Mode Tabs */}
                <div className="flex border-b border-gray-200 dark:border-gray-700">
                    <button
                        type="button"
                        onClick={() => setMode('single')}
                        className={`flex items-center gap-2 py-2 px-4 text-sm font-semibold border-b-2 transition ${mode === 'single'
                            ? 'border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400'
                            : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                            }`}
                    >
                        <Icon className="fas fa-plus text-xs" />
                        Single Equipment
                    </button>
                    <button
                        type="button"
                        onClick={() => setMode('bulk')}
                        className={`flex items-center gap-2 py-2 px-4 text-sm font-semibold border-b-2 transition ${mode === 'bulk'
                            ? 'border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400'
                            : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                            }`}
                    >
                        <Icon className="fas fa-file-csv text-xs" />
                        Bulk CSV Import
                    </button>
                </div>

                {/* MODE 1: SINGLE EQUIPMENT FORM */}
                {mode === 'single' && (
                    <form onSubmit={handleSingleSubmit} className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {/* Equipment Name */}
                            <div className="md:col-span-2">
                                <label htmlFor="infra-name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                    Equipment Name <span className="text-red-500">*</span>
                                </label>
                                <input
                                    id="infra-name"
                                    type="text"
                                    required
                                    autoFocus
                                    placeholder="e.g. Raith EBPG 5200"
                                    value={formData.name}
                                    onChange={(e) => handleInputChange('name', e.target.value)}
                                    className={`input-field ${formErrors.name ? 'border-red-500' : ''}`}
                                />
                                {formErrors.name && (
                                    <p className="text-xs text-red-500 mt-1">{formErrors.name}</p>
                                )}
                            </div>

                            {/* Category Selection */}
                            <div>
                                <label htmlFor="infra-category" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                    Category <span className="text-red-500">*</span>
                                </label>
                                <select
                                    id="infra-category"
                                    value={formData.category}
                                    onChange={(e) => handleInputChange('category', e.target.value)}
                                    className={`select-input ${formErrors.category ? 'border-red-500' : ''}`}
                                >
                                    <option value="">-- Select Category --</option>
                                    {existingCategories.map(cat => (
                                        <option key={cat} value={cat}>{cat}</option>
                                    ))}
                                    <option value="__custom__">+ Enter Custom Category...</option>
                                </select>
                                {formData.category === '__custom__' && (
                                    <input
                                        type="text"
                                        placeholder="New Category Name"
                                        value={formData.customCategory}
                                        onChange={(e) => handleInputChange('customCategory', e.target.value)}
                                        className="input-field mt-2 text-sm"
                                        autoFocus
                                    />
                                )}
                                {formErrors.category && (
                                    <p className="text-xs text-red-500 mt-1">{formErrors.category}</p>
                                )}
                            </div>

                            {/* Location */}
                            <div>
                                <label htmlFor="infra-location" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                    Laboratory Location
                                </label>
                                <input
                                    id="infra-location"
                                    type="text"
                                    list="locations-datalist"
                                    placeholder="e.g. Cleanroom D, Analysis Lab"
                                    value={formData.location}
                                    onChange={(e) => handleInputChange('location', e.target.value)}
                                    className="input-field"
                                />
                                <datalist id="locations-datalist">
                                    {existingLocations.map(loc => (
                                        <option key={loc} value={loc} />
                                    ))}
                                </datalist>
                            </div>

                            {/* Status */}
                            <div>
                                <label htmlFor="infra-status" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                    Initial Status
                                </label>
                                <select
                                    id="infra-status"
                                    value={formData.status}
                                    onChange={(e) => handleInputChange('status', e.target.value)}
                                    className="select-input"
                                >
                                    <option value="up">Available (Up)</option>
                                    <option value="service">Under Maintenance (Service)</option>
                                    <option value="down">Unavailable (Down)</option>
                                </select>
                            </div>

                            {/* Rate Category */}
                            <div>
                                <label htmlFor="infra-rate-category" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 flex items-center justify-between">
                                    <span className="flex items-center gap-1.5">
                                        <span>Rate Category</span>
                                        <button
                                            type="button"
                                            onClick={() => setIsPricingModalOpen(true)}
                                            className="text-xs text-blue-600 dark:text-blue-400 hover:underline cursor-pointer font-normal normal-case"
                                        >
                                            (view rates & modes)
                                        </button>
                                    </span>
                                    <RateCategoryBadge rate={formData.rate_category} size="xs" />
                                </label>
                                <select
                                    id="infra-rate-category"
                                    value={formData.rate_category}
                                    onChange={(e) => handleInputChange('rate_category', e.target.value)}
                                    className="select-input"
                                >
                                    <option value="A">Category A (Cheapest / Basic)</option>
                                    <option value="B">Category B (Standard)</option>
                                    <option value="C">Category C (Advanced)</option>
                                    <option value="D">Category D (Highest / Complex)</option>
                                </select>
                            </div>

                            {/* License Required Toggle */}
                            <div className="flex items-center pt-6">
                                <label className="relative flex items-center gap-2 cursor-pointer select-none">
                                    <input
                                        type="checkbox"
                                        checked={formData.license_req}
                                        onChange={(e) => handleInputChange('license_req', e.target.checked)}
                                        className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                                    />
                                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                        Require Operator License
                                    </span>
                                </label>
                            </div>

                            {/* Primary Tool Responsible */}
                            <div>
                                <label htmlFor="infra-primary-resp" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                    Primary Tool Responsible
                                </label>
                                <select
                                    id="infra-primary-resp"
                                    value={formData.primary_responsible_id}
                                    onChange={(e) => handleInputChange('primary_responsible_id', e.target.value)}
                                    className="select-input"
                                >
                                    <option value="">-- Select Responsible (Default: Admin) --</option>
                                    {availableUsers.map(u => (
                                        <option key={u.id} value={u.id}>
                                            {`${u.first_name || ''} ${u.last_name || ''}`.trim() || u.email} {u.job_title ? `(${u.job_title})` : ''} {u.access_level === 'admin' ? '[Admin]' : ''}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            {/* Secondary Tool Responsible */}
                            <div>
                                <label htmlFor="infra-secondary-resp" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                    Secondary Tool Responsible <span className="text-xs text-gray-500 font-normal">(Optional)</span>
                                </label>
                                <select
                                    id="infra-secondary-resp"
                                    value={formData.secondary_responsible_id}
                                    onChange={(e) => handleInputChange('secondary_responsible_id', e.target.value)}
                                    className="select-input"
                                >
                                    <option value="">-- None --</option>
                                    {availableUsers.filter(u => u.id !== formData.primary_responsible_id).map(u => (
                                        <option key={u.id} value={u.id}>
                                            {`${u.first_name || ''} ${u.last_name || ''}`.trim() || u.email} {u.job_title ? `(${u.job_title})` : ''} {u.access_level === 'admin' ? '[Admin]' : ''}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            {/* Image URL */}
                            <div className="md:col-span-2">
                                <label htmlFor="infra-image" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                    Equipment Image URL <span className="text-xs text-gray-500 font-normal">(Optional)</span>
                                </label>
                                <input
                                    id="infra-image"
                                    type="text"
                                    placeholder="https://example.com/photo.jpg"
                                    value={formData.image_url}
                                    onChange={(e) => handleInputChange('image_url', e.target.value)}
                                    className={`input-field ${formErrors.image_url ? 'border-red-500' : ''}`}
                                />
                                {formErrors.image_url ? (
                                    <p className="text-xs text-red-500 mt-1">{formErrors.image_url}</p>
                                ) : (
                                    <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
                                        Leave blank to use the standard placeholder icon or thumbnail pipeline.
                                    </p>
                                )}
                            </div>

                            {/* Description */}
                            <div className="md:col-span-2">
                                <label htmlFor="infra-description" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                    Description & Operating Notes
                                </label>
                                <textarea
                                    id="infra-description"
                                    rows="3"
                                    placeholder="Technical specifications, operating limits, or training requirements..."
                                    value={formData.description}
                                    onChange={(e) => handleInputChange('description', e.target.value)}
                                    className="input-field"
                                ></textarea>
                            </div>
                        </div>

                        {/* Modal Footer */}
                        <div className="flex justify-end gap-3 pt-4 border-t dark:border-gray-700">
                            <button
                                type="button"
                                onClick={onClose}
                                disabled={isSubmitting}
                                className="btn btn-secondary text-sm"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                disabled={isSubmitting}
                                className="btn btn-primary text-sm flex items-center gap-2"
                            >
                                {isSubmitting && <Icon className="fas fa-spinner fa-spin" />}
                                Add Equipment
                            </button>
                        </div>
                    </form>
                )}

                {/* MODE 2: BULK CSV IMPORT */}
                {mode === 'bulk' && (
                    <div className="space-y-4">
                        {/* Download Template Banner */}
                        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                            <div>
                                <h4 className="text-sm font-bold text-blue-900 dark:text-blue-200">
                                    Standard CSV Format
                                </h4>
                                <p className="text-xs text-blue-700 dark:text-blue-300 mt-0.5">
                                    Use our pre-configured template with proper column headers and sample equipment.
                                </p>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                                <button
                                    type="button"
                                    onClick={() => setIsPricingModalOpen(true)}
                                    className="btn btn-secondary btn-sm flex items-center gap-2 text-xs"
                                    title="View official equipment rate categories and access modes"
                                >
                                    <Icon className="fas fa-tags text-emerald-600 dark:text-emerald-400" />
                                    Rate Guide
                                </button>
                                <button
                                    type="button"
                                    onClick={() => downloadInfrastructureCsvTemplate()}
                                    className="btn btn-secondary btn-sm flex items-center gap-2 text-xs"
                                >
                                    <Icon className="fas fa-download" />
                                    Download CSV Template
                                </button>
                            </div>
                        </div>

                        {/* Upload Dropzone */}
                        <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-6 text-center hover:border-blue-500 transition">
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept=".csv,text/csv"
                                onChange={handleFileChange}
                                className="hidden"
                                id="csv-file-input"
                            />
                            <label htmlFor="csv-file-input" className="cursor-pointer flex flex-col items-center">
                                <Icon className="fas fa-upload text-3xl text-gray-400 mb-2" />
                                <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
                                    {csvFile ? csvFile.name : 'Click to select CSV file'}
                                </span>
                                <span className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                    {csvFile ? `${(csvFile.size / 1024).toFixed(1)} KB` : 'Accepts standard .csv files with UTF-8 encoding'}
                                </span>
                            </label>
                            {csvFile && (
                                <button
                                    type="button"
                                    onClick={handleClearCsv}
                                    className="mt-3 text-xs text-red-600 dark:text-red-400 hover:underline inline-flex items-center gap-1"
                                >
                                    <Icon className="fas fa-times" /> Remove file
                                </button>
                            )}
                        </div>

                        {csvFileError && (
                            <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 text-xs flex items-center gap-2">
                                <Icon className="fas fa-exclamation-triangle" />
                                <span>{csvFileError}</span>
                            </div>
                        )}

                        {/* CSV Preview Section */}
                        {csvParsed && !csvParsed.error && (
                            <div className="space-y-3">
                                <div className="flex items-center justify-between text-xs font-medium">
                                    <span className="text-gray-600 dark:text-gray-400">
                                        Total Rows Detected: <strong>{csvParsed.totalRows}</strong>
                                    </span>
                                    <div className="flex flex-wrap gap-2">
                                        <span className="bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 px-2 py-0.5 rounded">
                                            New: {csvParsed.newRows?.length ?? csvParsed.validRows.length}
                                        </span>
                                        {csvParsed.existingRows?.length > 0 && (
                                            <span className="bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded flex items-center gap-1">
                                                <Icon className="fas fa-shield-alt text-[10px]" /> Already in DB (Skipped): {csvParsed.existingRows.length}
                                            </span>
                                        )}
                                        {csvParsed.invalidRows.length > 0 && (
                                            <span className="bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 px-2 py-0.5 rounded">
                                                Invalid: {csvParsed.invalidRows.length}
                                            </span>
                                        )}
                                    </div>
                                </div>

                                {/* Preview Table */}
                                <div className="max-h-60 overflow-y-auto border dark:border-gray-700 rounded-lg text-xs">
                                    <table className="w-full text-left border-collapse">
                                        <thead className="bg-gray-50 dark:bg-gray-900 sticky top-0 border-b dark:border-gray-700">
                                            <tr>
                                                <th className="p-2">Name</th>
                                                <th className="p-2">Category</th>
                                                <th className="p-2">Rate</th>
                                                <th className="p-2">Location</th>
                                                <th className="p-2">Status</th>
                                                <th className="p-2">License</th>
                                                <th className="p-2">Status / Action</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y dark:divide-gray-700">
                                            {(csvParsed.newRows || csvParsed.validRows).map((row, idx) => (
                                                <tr key={`valid-${idx}`} className="hover:bg-blue-50/20">
                                                    <td className="p-2 font-medium text-gray-800 dark:text-gray-200">{row.name}</td>
                                                    <td className="p-2 text-gray-600 dark:text-gray-400">{row.category}</td>
                                                    <td className="p-2"><RateCategoryBadge rate={row.rate_category} /></td>
                                                    <td className="p-2 text-gray-500 dark:text-gray-400">{row.location || '—'}</td>
                                                    <td className="p-2"><StatusBadge status={row.status} /></td>
                                                    <td className="p-2 text-gray-600 dark:text-gray-400">{row.license_req ? 'Required' : 'None'}</td>
                                                    <td className="p-2 text-green-600 font-semibold flex items-center gap-1">
                                                        <Icon className="fas fa-check-circle" /> Ready to Add
                                                    </td>
                                                </tr>
                                            ))}
                                            {csvParsed.existingRows?.map((row, idx) => (
                                                <tr key={`existing-${idx}`} className="bg-blue-50/40 dark:bg-blue-900/10 opacity-75">
                                                    <td className="p-2 font-medium text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
                                                        <Icon className="fas fa-database text-blue-500 text-[10px]" />
                                                        {row.name}
                                                    </td>
                                                    <td className="p-2 text-gray-500 dark:text-gray-400">{row.category}</td>
                                                    <td className="p-2"><RateCategoryBadge rate={row.rate_category} /></td>
                                                    <td className="p-2 text-gray-500 dark:text-gray-400">{row.location || '—'}</td>
                                                    <td className="p-2"><StatusBadge status={row.status} /></td>
                                                    <td className="p-2 text-gray-500 dark:text-gray-400">{row.license_req ? 'Required' : 'None'}</td>
                                                    <td className="p-2 text-blue-600 dark:text-blue-400 font-medium flex items-center gap-1">
                                                        <Icon className="fas fa-shield-alt" /> In DB (Protected)
                                                    </td>
                                                </tr>
                                            ))}
                                            {csvParsed.invalidRows.map((inv, idx) => (
                                                <tr key={`invalid-${idx}`} className="bg-red-50/50 dark:bg-red-900/10">
                                                    <td className="p-2 font-medium text-red-900 dark:text-red-200">{inv.data.name || '(Empty name)'}</td>
                                                    <td className="p-2 text-gray-600 dark:text-gray-400">{inv.data.category || '(Empty)'}</td>
                                                    <td className="p-2"><RateCategoryBadge rate={inv.data.rate_category} /></td>
                                                    <td className="p-2 text-gray-500 dark:text-gray-400">{inv.data.location || '—'}</td>
                                                    <td className="p-2">{inv.data.status}</td>
                                                    <td className="p-2">{String(inv.data.license_req)}</td>
                                                    <td className="p-2 text-red-600 dark:text-red-400">
                                                        {inv.errors.join('; ')}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}

                        {/* Modal Footer */}
                        <div className="flex justify-end gap-3 pt-4 border-t dark:border-gray-700">
                            <button
                                type="button"
                                onClick={onClose}
                                disabled={isSubmitting}
                                className="btn btn-secondary text-sm"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handleBulkSubmit}
                                disabled={isSubmitting || !csvParsed || (csvParsed.newRows ? csvParsed.newRows.length === 0 : csvParsed.validRows.length === 0)}
                                className="btn btn-primary text-sm flex items-center gap-2"
                            >
                                {isSubmitting && <Icon className="fas fa-spinner fa-spin" />}
                                Import {(csvParsed?.newRows?.length ?? csvParsed?.validRows?.length) ? `${csvParsed?.newRows?.length ?? csvParsed.validRows.length} New Tool(s)` : ''}
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Rate & Pricing Guide Modal */}
            <RatePricingModal
                isOpen={isPricingModalOpen}
                onClose={() => setIsPricingModalOpen(false)}
            />
        </div>
    );
};

export default AddInfrastructureModal;
