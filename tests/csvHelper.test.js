import test from 'node:test';
import assert from 'node:assert/strict';
import {
    escapeCsvField,
    generateInfrastructureCsvTemplate,
    parseRawCsv,
    parseInfrastructureCsv
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
    assert.equal(lines[0], 'name,category,status,location,license_req,description,image_url');
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
    assert.equal(raith.status, 'up');
    assert.equal(raith.location, 'Cleanroom D');
    assert.equal(raith.license_req, true);

    const dektak = result.validRows.find(r => r.name === 'Dektak XT');
    assert.ok(dektak);
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
