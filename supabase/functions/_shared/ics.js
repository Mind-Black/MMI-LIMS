import crypto from 'node:crypto';

/**
 * Escapes text values for RFC 5545 compliance.
 * Backslashes, semicolons, commas, and newlines must be escaped.
 * Handles CRLF, bare CR, and bare LF correctly.
 */
export function escapeICSText(text) {
    if (!text) return '';
    return String(text)
        .replace(/\\/g, '\\\\')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,')
        .replace(/\r\n|\r|\n/g, '\\n');
}

/**
 * Folds ICS lines according to RFC 5545 (limit to 75 octets per line).
 * Lines are split and continued with CRLF + space.
 */
export function foldICSLine(line) {
    if (!line) return '';
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
        const limit = isFirst ? maxOctets : maxOctets - 1;
        let end = Math.min(start + limit, bytes.length);

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

/**
 * Formats a Date object as RFC 5545 UTC timestamp: YYYYMMDDTHHMMSSZ
 */
export function formatICSDateUTC(date) {
    return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

/**
 * Computes deterministic SHA-256 hash in hex format for bearer tokens
 */
export async function sha256Hex(message) {
    if (crypto?.webcrypto?.subtle) {
        const msgUint8 = new TextEncoder().encode(message);
        const hashBuffer = await crypto.webcrypto.subtle.digest('SHA-256', msgUint8);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }
    return crypto.createHash('sha256').update(message).digest('hex');
}
