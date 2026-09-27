import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeICSText, foldICSLine, sha256Hex, formatICSDateUTC } from '../src/utils/icsHelper.js';

test('escapeICSText escapes RFC 5545 special characters', () => {
    const raw = 'Test, with; special\\chars and\nnewlines';
    const escaped = escapeICSText(raw);
    assert.equal(escaped, 'Test\\, with\\; special\\\\chars and\\nnewlines');
});

test('escapeICSText handles CRLF, bare LF, and bare CR (R13)', () => {
    // CRLF
    assert.equal(escapeICSText('Line1\r\nLine2'), 'Line1\\nLine2');
    // Bare LF
    assert.equal(escapeICSText('Line1\nLine2'), 'Line1\\nLine2');
    // Bare CR (R13)
    assert.equal(escapeICSText('Line1\rLine2'), 'Line1\\nLine2');
    // Mixed
    assert.equal(escapeICSText('A\r\nB\rC\nD'), 'A\\nB\\nC\\nD');
});

test('escapeICSText prevents calendar injection (S6)', () => {
    const injected = 'Normal Project\r\nBEGIN:VEVENT\r\nSUMMARY:Injected Event\r\nEND:VEVENT';
    const escaped = escapeICSText(injected);
    assert.doesNotMatch(escaped, /\r/);
    assert.doesNotMatch(escaped, /\n/);
    assert.match(escaped, /\\nBEGIN:VEVENT/);
});

test('foldICSLine limits line length to <= 75 octets per line with multibyte safety', () => {
    // Includes multibyte characters (Lithuanian/accented and symbols)
    const longSummary = 'SUMMARY:This is a very long lab description with ąčęėįšųūž and symbols that exceeds 75 octets and must be folded properly by the serializer according to RFC 5545.';
    const folded = foldICSLine(longSummary);

    const lines = folded.split('\r\n');
    assert.ok(lines.length > 1, 'Long line must be split into multiple lines');

    const encoder = new TextEncoder();
    for (const line of lines) {
        assert.ok(encoder.encode(line).length <= 75, `Line exceeded 75 octets (${encoder.encode(line).length}): ${line}`);
    }
    // Each subsequent line must start with a space or tab
    for (let i = 1; i < lines.length; i++) {
        assert.ok(lines[i].startsWith(' ') || lines[i].startsWith('\t'), 'Continuation line must start with space or tab');
    }
});

test('sha256Hex calculates deterministic 64-char hex hashes for bearer tokens (S2)', async () => {
    const token = 'my-secret-calendar-token-12345';
    const hash1 = await sha256Hex(token);
    const hash2 = await sha256Hex(token);
    assert.equal(hash1, hash2);
    assert.equal(hash1.length, 64);
    assert.notEqual(token, hash1);
});

test('formatICSDateUTC formats Date objects as RFC 5545 UTC timestamps', () => {
    const d = new Date('2026-09-28T10:30:00Z');
    assert.equal(formatICSDateUTC(d), '20260928T103000Z');
});
