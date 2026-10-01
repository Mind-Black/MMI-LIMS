import test from 'node:test';
import assert from 'node:assert/strict';
import {
    escapeCsvField,
    generateInfrastructureCsvTemplate,
    parseRawCsv,
    parseInfrastructureCsv,
    findMatchingExistingTool
} from '../src/utils/csvHelper.js';

test('escapeCsvField: correctly handles strings with commas, quotes, and newlines', () => {
    assert.equal(escapeCsvField('Cleanroom D'), 'Cleanroom D');
    assert.equal(escapeCsvField('Lithography, Metrology'), '"Lithography, Metrology"');
    assert.equal(escapeCsvField('He said "hello"'), '"He said ""hello"""');
    assert.equal(escapeCsvField('Line1\nLine2'), '"Line1\nLine2"');
    assert.equal(escapeCsvField(null), '');
    assert.equal(escapeCsvField(undefined), '');
});

test('generateInfrastructureCsvTemplate: contains standard headers and sample data', () => {
    const template = generateInfrastructureCsvTemplate();
    const lines = template.split('\r\n');
    assert.ok(lines.length >= 6);
    assert.equal(lines[0], 'name,category,rate_category,status,location,license_req,description,image_url');
    assert.ok(lines.some(l => l.includes('Raith EBPG 5200')));
    assert.ok(lines.some(l => l.includes('Dektak XT')));
});

test('parseRawCsv: parses simple and RFC 4180 quoted CSV lines', () => {
    const csv = 'name,category,status\n"Raith, EBPG 5200",Lithography,up\n"Heidelberg ""DWL"" 2000",Lithography,up';
    const rows = parseRawCsv(csv);
    assert.equal(rows.length, 3);
    assert.deepEqual(rows[0], ['name', 'category', 'status']);
    assert.deepEqual(rows[1], ['Raith, EBPG 5200', 'Lithography', 'up']);
    assert.deepEqual(rows[2], ['Heidelberg "DWL" 2000', 'Lithography', 'up']);
});

test('parseInfrastructureCsv: parses valid template CSV accurately', () => {
    const template = generateInfrastructureCsvTemplate();
    const result = parseInfrastructureCsv(template);

    assert.equal(result.hasErrors, false);
    assert.equal(result.invalidRows.length, 0);
    assert.ok(result.validRows.length >= 5);

    const raith = result.validRows.find(r => r.name === 'Raith EBPG 5200');
    assert.ok(raith);
    assert.equal(raith.category, 'Lithography');
    assert.equal(raith.rate_category, 'D');
    assert.equal(raith.status, 'up');
    assert.equal(raith.location, 'Cleanroom D');
    assert.equal(raith.license_req, true);

    const dektak = result.validRows.find(r => r.name === 'Dektak XT');
    assert.ok(dektak);
    assert.equal(dektak.rate_category, 'B');
    assert.equal(dektak.license_req, false);
});

test('parseInfrastructureCsv: flags missing headers or empty file', () => {
    const emptyResult = parseInfrastructureCsv('');
    assert.ok(emptyResult.error);

    const badHeaders = parseInfrastructureCsv('title,description\nMy Tool,Something');
    assert.ok(badHeaders.hasErrors);
    assert.ok(badHeaders.error.includes('Missing required header'));
});

test('parseInfrastructureCsv: flags invalid row fields with descriptive errors', () => {
    const badCsv = `name,category,status,license_req,image_url
,Lithography,up,true,
Valid Tool,,up,true,
Another Tool,Etching,invalid_status,true,
Good Tool,Deposition,up,not_a_bool,
Invalid Image Tool,Deposition,up,true,ftp://bad-url.com
`;
    const result = parseInfrastructureCsv(badCsv);
    assert.equal(result.hasErrors, true);
    assert.equal(result.invalidRows.length, 5);

    assert.ok(result.invalidRows[0].errors.some(e => e.includes('Equipment name is required')));
    assert.ok(result.invalidRows[1].errors.some(e => e.includes('Category is required')));
    assert.ok(result.invalidRows[2].errors.some(e => e.includes('Invalid status')));
    assert.ok(result.invalidRows[3].errors.some(e => e.includes('Invalid license_req')));
    assert.ok(result.invalidRows[4].errors.some(e => e.includes('Image URL must start with')));
});

test('findMatchingExistingTool: identifies tools already present in the database', () => {
    const existingTools = [
        { id: 1, name: 'EBL: Raith e-Line Plus' },
        { id: 2, name: 'Laser: FemtoLAB' },
        { id: 3, name: 'SEM: FEI Quanta 200 FEG' },
        { id: 5, name: 'ICPRIE: PlasmaTherm Apex SLR' },
        { id: 6, name: 'Thermal Evaporation: CUBIVAP' },
        { id: 7, name: 'Sputter: LH A700' },
        { id: 8, name: 'Raman: Renishaw InVia' }
    ];

    // Matches with variations / full names from KTU export
    assert.ok(findMatchingExistingTool('EBL: E-beam lithography tool - Raith e-Line Plus', existingTools));
    assert.ok(findMatchingExistingTool('SEM: Scanning electron microscope - FEI Quanta 200 FEG', existingTools));
    assert.ok(findMatchingExistingTool('Thermal evaporator - CUBIVAP', existingTools));
    assert.ok(findMatchingExistingTool('Magnetron sputtering tool - LH A700', existingTools));
    assert.ok(findMatchingExistingTool('Raman scattering spectrometer - Renishaw inVia', existingTools));
    assert.ok(findMatchingExistingTool('ICP RIE: Inductively coupled plasma reactive ion etching system - PlasmaTherm Apex SLR', existingTools));
    assert.ok(findMatchingExistingTool('Laser: FemtoLAB', existingTools));
    assert.ok(findMatchingExistingTool('Universal optical spectroscopy and laser microfabrication system', existingTools));

    // Brand new tool that does NOT exist in the database
    assert.equal(findMatchingExistingTool('XRD: X-ray diffractometer - Bruker D8 Discover', existingTools), null);
    assert.equal(findMatchingExistingTool('Ophir Nova II', existingTools), null);
});

test('parseInfrastructureCsv: partitions new and existing tools to protect database tools from overwrite', () => {
    const existingTools = [
        { id: 1, name: 'EBL: Raith e-Line Plus' },
        { id: 3, name: 'SEM: FEI Quanta 200 FEG' }
    ];

    const csvContent = `name,category,status,location,license_req,description,image_url
EBL: Raith e-Line Plus,Lithography,up,Cleanroom D,true,Existing Raith,
XRD: Bruker D8 Discover,Characterization,up,Room A119,true,Brand new XRD,
SEM: FEI Quanta 200 FEG,Microscopy,up,Room A115,true,Existing SEM,
`;

    const result = parseInfrastructureCsv(csvContent, existingTools);

    assert.equal(result.totalRows, 3);
    assert.equal(result.hasErrors, false);
    assert.equal(result.newRows.length, 1);
    assert.equal(result.newRows[0].name, 'XRD: Bruker D8 Discover');

    assert.equal(result.existingRows.length, 2);
    assert.ok(result.existingRows.some(r => r.name === 'EBL: Raith e-Line Plus'));
    assert.ok(result.existingRows.some(r => r.name === 'SEM: FEI Quanta 200 FEG'));
});

test('parseInfrastructureCsv: handles rate_category defaults, case normalization, and invalid validation', () => {
    const csvContent = `name,category,rate_category,status
Tool Alpha,Deposition,A,up
Tool Beta,Deposition,b,up
Tool Gamma,Deposition,c,up
Tool Delta,Deposition,D,up
Tool Default,Deposition,,up
Tool BadRate,Deposition,Z,up
`;
    const result = parseInfrastructureCsv(csvContent);

    assert.equal(result.totalRows, 6);
    assert.equal(result.validRows.length, 5);
    assert.equal(result.invalidRows.length, 1);

    const alpha = result.validRows.find(r => r.name === 'Tool Alpha');
    const beta = result.validRows.find(r => r.name === 'Tool Beta');
    const gamma = result.validRows.find(r => r.name === 'Tool Gamma');
    const delta = result.validRows.find(r => r.name === 'Tool Delta');
    const def = result.validRows.find(r => r.name === 'Tool Default');

    assert.equal(alpha.rate_category, 'A');
    assert.equal(beta.rate_category, 'B'); // normalized from 'b'
    assert.equal(gamma.rate_category, 'C'); // normalized from 'c'
    assert.equal(delta.rate_category, 'D');
    assert.equal(def.rate_category, 'A'); // defaulted to 'A' when omitted/empty

    const bad = result.invalidRows[0];
    assert.equal(bad.data.name, 'Tool BadRate');
    assert.ok(bad.errors.some(e => e.includes('Invalid rate category')));
});
