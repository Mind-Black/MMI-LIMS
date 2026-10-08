/**
 * csvHelper.js
 * Utility functions for generating, downloading, and parsing CSV data
 * for laboratory infrastructure (tools / equipment) bulk management.
 */

export const CSV_TEMPLATE_HEADERS = [
    'name',
    'category',
    'rate_category',
    'status',
    'location',
    'license_req',
    'description',
    'image_url'
];

export const CSV_SAMPLE_DATA = [
    {
        name: 'Raith EBPG 5200',
        category: 'Lithography',
        rate_category: 'D',
        status: 'up',
        location: 'Cleanroom D',
        license_req: 'true',
        description: 'Electron Beam Lithography system. High resolution patterning.',
        image_url: ''
    },
    {
        name: 'Heidelberg DWL 2000',
        category: 'Lithography',
        rate_category: 'C',
        status: 'up',
        location: 'Cleanroom D',
        license_req: 'true',
        description: 'Laser lithography system for mask making and direct write.',
        image_url: ''
    },
    {
        name: 'JEOL 7800F Prime',
        category: 'Metrology',
        rate_category: 'C',
        status: 'up',
        location: 'Analysis Lab',
        license_req: 'true',
        description: 'High resolution SEM with EDS.',
        image_url: ''
    },
    {
        name: 'Dektak XT',
        category: 'Metrology',
        rate_category: 'B',
        status: 'up',
        location: 'Cleanroom E',
        license_req: 'false',
        description: 'Stylus profilometer.',
        image_url: ''
    },
    {
        name: 'Oxford PlasmaPro 100',
        category: 'Etching',
        rate_category: 'D',
        status: 'down',
        location: 'Cleanroom A',
        license_req: 'true',
        description: 'ICP-RIE for III-V etching.',
        image_url: ''
    }
];

/**
 * Escapes a single CSV field following RFC 4180
 */
export function escapeCsvField(val) {
    if (val === null || val === undefined) return '';
    const str = String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
}

/**
 * Generates CSV template string with headers and sample rows
 */
export function generateInfrastructureCsvTemplate() {
    const headerLine = CSV_TEMPLATE_HEADERS.join(',');
    const rows = CSV_SAMPLE_DATA.map(item =>
        CSV_TEMPLATE_HEADERS.map(h => escapeCsvField(item[h])).join(',')
    );
    return [headerLine, ...rows].join('\r\n');
}

/**
 * Triggers a client-side download of the CSV template
 */
export function downloadInfrastructureCsvTemplate(filename = 'infrastructure_template.csv') {
    const csvContent = generateInfrastructureCsvTemplate();
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

/**
 * RFC 4180 compliant CSV line tokenizer
 * Splits a CSV line or multiline block into rows of field arrays
 */
export function parseRawCsv(csvText) {
    if (!csvText || typeof csvText !== 'string') return [];

    const rows = [];
    let currentRow = [];
    let currentField = '';
    let inQuotes = false;
    let i = 0;
    const len = csvText.length;

    while (i < len) {
        const char = csvText[i];
        const nextChar = csvText[i + 1];

        if (inQuotes) {
            if (char === '"') {
                if (nextChar === '"') {
                    // Escaped quote
                    currentField += '"';
                    i += 2;
                    continue;
                } else {
                    // End of quoted section
                    inQuotes = false;
                    i++;
                    continue;
                }
            } else {
                currentField += char;
                i++;
                continue;
            }
        } else {
            if (char === '"') {
                inQuotes = true;
                i++;
                continue;
            } else if (char === ',') {
                currentRow.push(currentField.trim());
                currentField = '';
                i++;
                continue;
            } else if (char === '\r') {
                if (nextChar === '\n') {
                    i++; // skip \n of \r\n
                }
                currentRow.push(currentField.trim());
                currentField = '';
                if (currentRow.some(f => f.length > 0)) {
                    rows.push(currentRow);
                }
                currentRow = [];
                i++;
                continue;
            } else if (char === '\n') {
                currentRow.push(currentField.trim());
                currentField = '';
                if (currentRow.some(f => f.length > 0)) {
                    rows.push(currentRow);
                }
                currentRow = [];
                i++;
                continue;
            } else {
                currentField += char;
                i++;
                continue;
            }
        }
    }

    if (currentField.length > 0 || currentRow.length > 0) {
        currentRow.push(currentField.trim());
        if (currentRow.some(f => f.length > 0)) {
            rows.push(currentRow);
        }
    }

    return rows;
}

/**
 * Maps raw headers to normalized field keys
 */
function normalizeHeader(header) {
    const clean = header.toLowerCase().replace(/[\s_-]+/g, '');
    if (['name', 'toolname', 'equipmentname', 'title'].includes(clean)) return 'name';
    if (['category', 'cat', 'type', 'group'].includes(clean)) return 'category';
    if (['ratecategory', 'rate_category', 'rate', 'rateclass', 'tier', 'ratetier', 'pricingtier', 'kainoskategorija', 'kaina'].includes(clean)) return 'rate_category';
    if (['status', 'state', 'operationalstatus'].includes(clean)) return 'status';
    if (['location', 'room', 'cleanroom', 'lab', 'bay'].includes(clean)) return 'location';
    if (['licensereq', 'licenserequired', 'license', 'needslicense', 'authorizationrequired'].includes(clean)) return 'license_req';
    if (['description', 'desc', 'notes', 'specifications', 'specs'].includes(clean)) return 'description';
    if (['imageurl', 'image', 'photo', 'photourl', 'thumbnail'].includes(clean)) return 'image_url';
    return clean;
}

/**
 * Parses and validates CSV content for infrastructure tools
 * @param {string} csvText
 * @returns {{
 *   totalRows: number,
 *   validRows: Array<object>,
 *   invalidRows: Array<{ rowNumber: number, data: object, errors: string[] }>,
 *   hasErrors: boolean
 * }}
 */
export function parseInfrastructureCsv(csvText, existingTools = []) {
    const rawRows = parseRawCsv(csvText);

    if (rawRows.length === 0) {
        return {
            totalRows: 0,
            validRows: [],
            invalidRows: [],
            hasErrors: false,
            error: 'The CSV file is empty.'
        };
    }

    const rawHeaders = rawRows[0];
    const headerMap = rawHeaders.map(h => normalizeHeader(h));

    if (!headerMap.includes('name') || !headerMap.includes('category')) {
        return {
            totalRows: 0,
            validRows: [],
            invalidRows: [],
            hasErrors: true,
            error: 'Missing required header columns: CSV must contain at least "name" and "category".'
        };
    }

    const validRows = [];
    const invalidRows = [];
    const validStatuses = ['up', 'down', 'service'];

    for (let r = 1; r < rawRows.length; r++) {
        const row = rawRows[r];
        const rowObj = {};
        const errors = [];

        headerMap.forEach((col, idx) => {
            rowObj[col] = (row[idx] !== undefined ? row[idx] : '').trim();
        });

        // 1. Name validation
        const name = rowObj.name;
        if (!name) {
            errors.push('Equipment name is required.');
        } else if (name.length < 2) {
            errors.push('Equipment name must be at least 2 characters.');
        } else if (name.length > 100) {
            errors.push('Equipment name cannot exceed 100 characters.');
        }

        // 2. Category validation
        const category = rowObj.category;
        if (!category) {
            errors.push('Category is required.');
        } else if (category.length > 100) {
            errors.push('Category cannot exceed 100 characters.');
        }

        // 3. Rate category validation (defaults to 'A' if omitted)
        let rate_category = 'A';
        if (rowObj.rate_category !== undefined && rowObj.rate_category !== '') {
            const rc = String(rowObj.rate_category).toUpperCase().trim();
            if (['A', 'B', 'C', 'D'].includes(rc)) {
                rate_category = rc;
            } else {
                errors.push(`Invalid rate category "${rowObj.rate_category}". Expected A, B, C, or D.`);
            }
        }

        // 4. Status normalization & validation
        let status = (rowObj.status || 'up').toLowerCase();
        if (status === 'available' || status === 'active' || status === 'ready') status = 'up';
        if (status === 'unavailable' || status === 'offline' || status === 'broken') status = 'down';
        if (status === 'maintenance' || status === 'servicing') status = 'service';

        if (!validStatuses.includes(status)) {
            errors.push(`Invalid status "${rowObj.status}". Must be 'up', 'down', or 'service'.`);
        }

        // 5. License requirement normalization
        let license_req = true;
        if (rowObj.license_req !== undefined && rowObj.license_req !== '') {
            const lStr = String(rowObj.license_req).toLowerCase().trim();
            if (['false', '0', 'no', 'none', 'f', 'n'].includes(lStr)) {
                license_req = false;
            } else if (['true', '1', 'yes', 'y', 't'].includes(lStr)) {
                license_req = true;
            } else {
                errors.push(`Invalid license_req "${rowObj.license_req}". Expected true/false.`);
            }
        }

        // 6. Image URL validation
        let image_url = rowObj.image_url ? rowObj.image_url.trim() : null;
        if (image_url && !image_url.startsWith('http://') && !image_url.startsWith('https://') && !image_url.startsWith('/')) {
            errors.push('Image URL must start with http://, https://, or /');
        }

        const location = rowObj.location ? rowObj.location.trim() : null;
        const description = rowObj.description ? rowObj.description.trim() : null;

        const cleanedRecord = {
            name,
            category,
            rate_category,
            status,
            location,
            license_req,
            description,
            image_url: image_url || null
        };

        if (errors.length > 0) {
            invalidRows.push({
                rowNumber: r + 1,
                data: { ...rowObj, ...cleanedRecord },
                errors
            });
        } else {
            validRows.push(cleanedRecord);
        }
    }

    // Partition valid rows against existing database tools if provided
    const newRows = [];
    const existingRows = [];

    validRows.forEach(row => {
        const matched = findMatchingExistingTool(row.name, existingTools);
        if (matched) {
            existingRows.push({ ...row, matchedExisting: matched });
        } else {
            newRows.push(row);
        }
    });

    return {
        totalRows: rawRows.length - 1,
        validRows,
        newRows,
        existingRows,
        invalidRows,
        hasErrors: invalidRows.length > 0
    };
}

/**
 * Checks whether an incoming equipment name matches an existing tool in the database.
 * Matches exact normalized names, key model identifiers, and significant substrings.
 * @param {string} toolName - Name of tool from CSV
 * @param {Array<object>} existingTools - Array of existing tools in the database
 * @returns {object|null} Matched existing tool object or null
 */
export function findMatchingExistingTool(toolName, existingTools = []) {
    if (!toolName || !existingTools || !Array.isArray(existingTools) || existingTools.length === 0) {
        return null;
    }
    const cleanTarget = String(toolName).toLowerCase().replace(/[\s\-_:]+/g, ' ').trim();
    
    for (const ext of existingTools) {
        if (!ext || !ext.name) continue;
        const cleanExt = String(ext.name).toLowerCase().replace(/[\s\-_:]+/g, ' ').trim();
        
        // 1. Direct name equality
        if (cleanTarget === cleanExt) return ext;

        // 2. High-confidence model / brand identifiers
        const signatureKeys = [
            'raith e line',
            'femtolab',
            'quanta 200',
            'apex slr',
            'cubivap',
            'lh a700',
            'renishaw invia',
            'dektak'
        ];
        for (const key of signatureKeys) {
            if (cleanTarget.includes(key) && cleanExt.includes(key)) {
                return ext;
            }
        }

        // Special case: FemtoLAB in DB vs "Universal optical spectroscopy and laser microfabrication system" in export
        if (cleanExt.includes('femtolab') && (cleanTarget.includes('femto') || cleanTarget.includes('laser microfabrication') || cleanTarget.includes('lazerinio mikroapdirbimo'))) {
            return ext;
        }
        
        // 3. Substring match for substantial names (>= 10 chars)
        if (cleanExt.length >= 10 && cleanTarget.includes(cleanExt)) return ext;
        if (cleanTarget.length >= 10 && cleanExt.includes(cleanTarget)) return ext;
    }
    return null;
}
