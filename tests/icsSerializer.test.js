import test from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';

function escapeICSText(text) {
    if (!text) return '';
    return String(text)
        .replace(/\\/g, '\\\\')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,')
        .replace(/\r?\n/g, '\\n');
}

function foldICSLine(line) {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(line);
    const maxOctets = 75;

    if (bytes.length <= maxOctets) {
        return line;
    }

    const decoder = new TextDecoder();
    let result = '';
    let start = 0;
    let isFirst = true;

    while (start < bytes.length) {
        const limit = isFirst ? maxOctets : maxOctets - 1; // 1 octet reserved for continuation space
        let end = Math.min(start + limit, bytes.length);

        // UTF-8 continuation bytes have bits 10xxxxxx (0x80 - 0xBF)
        while (end > start && end < bytes.length && (bytes[end] & 0xC0) === 0x80) {
            end--;
        }

        const chunkStr = decoder.decode(bytes.subarray(start, end));

        if (isFirst) {
            result = chunkStr;
            isFirst = false;
        } else {
            result += '\r\n ' + chunkStr;
        }

        start = end;
    }

    return result;
}

function sha256Hex(str) {
    return crypto.createHash('sha256').update(str).digest('hex');
}

test('escapeICSText escapes RFC 5545 special characters', () => {
    const raw = 'Test, with; special\\chars and\nnewlines';
    const escaped = escapeICSText(raw);
    assert.strictEqual(escaped, 'Test\\, with\\; special\\\\chars and\\nnewlines');
});

test('escapeICSText prevents calendar injection (S6)', () => {
    const injected = 'Normal Project\r\nBEGIN:VEVENT\r\nSUMMARY:Injected Event\r\nEND:VEVENT';
    const escaped = escapeICSText(injected);
    assert.doesNotMatch(escaped, /\r\n/);
    assert.match(escaped, /\\nBEGIN:VEVENT/);
});

test('foldICSLine limits line length to <= 75 octets per line', () => {
    const longSummary = 'SUMMARY:This is a very long description that exceeds seventy-five octets in length and must be folded properly by the serializer according to the RFC 5545 specification.';
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

test('sha256Hex calculates deterministic 64-char hex hashes for bearer tokens (S2)', () => {
    const token = 'my-secret-calendar-token-12345';
    const hash1 = sha256Hex(token);
    const hash2 = sha256Hex(token);
    assert.strictEqual(hash1, hash2);
    assert.strictEqual(hash1.length, 64);
    assert.notStrictEqual(token, hash1);
});
