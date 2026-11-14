/**
 * Shared normalization and RSS/JSON formatting helpers for Microsoft Bookings sync.
 * Compatible with Deno Edge Functions, Node.js tests, and browser linting rules.
 */

const WINDOWS_TO_IANA = {
  'fle standard time': 'Europe/Vilnius',
  'e. europe standard time': 'Europe/Bucharest',
  'utc': 'UTC',
  'coordinated universal time': 'UTC'
};

export function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  const maxLen = Math.max(aBytes.length, bBytes.length);
  let diff = aBytes.length ^ bBytes.length;
  for (let i = 0; i < maxLen; i++) {
    diff |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
  }
  return diff === 0;
}

export function escapeXml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function resolveIanaZone(zone) {
  if (!zone || typeof zone !== 'string') return null;
  const trimmed = zone.trim();
  if (!trimmed) return null;
  const mapped = WINDOWS_TO_IANA[trimmed.toLowerCase()] || trimmed;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: mapped });
    return mapped;
  } catch {
    return null;
  }
}

function wallTimeInZoneToIso(datePart, timePart, timeZone) {
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour, minute, secRaw = '0'] = timePart.split(':');
  const second = Math.floor(Number(secRaw) || 0);
  const utcGuess = Date.UTC(year, month - 1, day, Number(hour), Number(minute), second);

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  const parts = formatter.formatToParts(new Date(utcGuess));
  const getPart = (type) => Number(parts.find((p) => p.type === type)?.value || 0);
  let zHour = getPart('hour');
  if (zHour === 24) zHour = 0;
  const zoneAsUtc = Date.UTC(
    getPart('year'),
    getPart('month') - 1,
    getPart('day'),
    zHour,
    getPart('minute'),
    getPart('second')
  );
  const offsetMs = zoneAsUtc - utcGuess;
  return new Date(utcGuess - offsetMs).toISOString();
}

export function toIsoTimestamp(value, fallbackZone = null) {
  if (!value) return null;
  let rawStr = null;
  let zone = fallbackZone;

  if (typeof value === 'object') {
    rawStr = value.dateTime ?? value.DateTime ?? null;
    zone = value.timeZone ?? value.TimeZone ?? fallbackZone;
  } else {
    rawStr = String(value);
  }

  if (!rawStr || typeof rawStr !== 'string') return null;
  const trimmed = rawStr.trim();
  if (!trimmed) return null;

  // Already carries explicit UTC 'Z' or numeric offset (+02:00 / -0500)
  if (/(Z|[+-]\d{2}:?\d{2})$/i.test(trimmed)) {
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  const wallMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)$/);
  if (wallMatch) {
    const ianaZone = resolveIanaZone(zone);
    if (!ianaZone || ianaZone === 'UTC') {
      const parsed = new Date(`${wallMatch[1]}T${wallMatch[2]}Z`);
      return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
    }
    return wallTimeInZoneToIso(wallMatch[1], wallMatch[2], ianaZone);
  }

  const fallbackDate = new Date(trimmed);
  return Number.isNaN(fallbackDate.getTime()) ? null : fallbackDate.toISOString();
}

function parseMaybeArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return parsed;
      } catch {
        return [];
      }
    }
  }
  return [];
}

function cleanString(value) {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  return str.length > 0 ? str : null;
}

export function normalizeEventType(raw) {
  const val = String(raw ?? 'created').trim().toLowerCase();
  if (['created', 'create', 'new', 'added', 'appointmentcreated'].includes(val)) return 'created';
  if (['updated', 'update', 'modified', 'changed', 'appointmentupdated'].includes(val)) return 'updated';
  if (['cancelled', 'canceled', 'cancel', 'deleted', 'delete', 'removed', 'appointmentcancelled', 'appointmentcanceled', 'appointmentdeleted'].includes(val)) return 'cancelled';
  return val;
}

export function normalizeInboundPayload(input = {}) {
  const staffMembers = parseMaybeArray(input.StaffMembers ?? input.staffMembers);
  const firstStaff = staffMembers[0] && typeof staffMembers[0] === 'object' ? staffMembers[0] : null;
  const staffIds = parseMaybeArray(input.staffMemberIds ?? input.StaffMemberIds);

  const customers = parseMaybeArray(input.Customers ?? input.customers);
  const firstCustomer = customers[0] && typeof customers[0] === 'object' ? customers[0] : null;

  const fallbackZone = cleanString(input.TimeZone ?? input.timeZone ?? input.StartTimeZone);

  const msBookingsEmail = cleanString(
    input.ms_bookings_email ??
    input.msBookingsEmail ??
    input.BookingBusinessId ??
    input.SmtpAddress ??
    input.bookingBusinessId ??
    input.business
  );

  const externalId = cleanString(
    input.external_id ??
    input.SelfServiceAppointmentId ??
    input.appointmentId ??
    input.Id ??
    input.id
  );

  const eventType = normalizeEventType(
    input.event_type ?? input.EventType ?? input.actionType ?? input.ActionType ?? 'created'
  );

  const startsAt = toIsoTimestamp(
    input.starts_at ?? input.StartTime ?? input.startDateTime ?? input.start,
    fallbackZone
  );

  const endsAt = toIsoTimestamp(
    input.ends_at ?? input.EndTime ?? input.endDateTime ?? input.end,
    cleanString(input.EndTimeZone) ?? fallbackZone
  );

  const serviceId = cleanString(input.service_id ?? input.ServiceId ?? input.serviceId);
  const serviceName = cleanString(
    input.service_name ?? input.ServiceName ?? input.serviceName ?? input.service
  );

  const staffId = cleanString(
    input.staff_id ??
    input.StaffId ??
    (typeof staffIds[0] === 'string' ? staffIds[0] : null) ??
    firstStaff?.Id ??
    firstStaff?.id ??
    firstStaff?.StaffMemberId ??
    firstStaff?.staffMemberId
  );

  const staffEmail = cleanString(
    input.staff_email ??
    input.staffEmail ??
    input.StaffEmail ??
    firstStaff?.EmailAddress ??
    firstStaff?.emailAddress ??
    firstStaff?.email
  );

  const customerEmail = cleanString(
    input.customer_email ??
    input.customerEmail ??
    input.customerEmailAddress ??
    input.CustomerEmail ??
    input.CustomerEmailAddress ??
    firstCustomer?.emailAddress ??
    firstCustomer?.EmailAddress ??
    firstCustomer?.email
  );

  const customerName = cleanString(
    input.customer_name ??
    input.customerName ??
    input.CustomerName ??
    firstCustomer?.name ??
    firstCustomer?.Name
  );

  const noteCandidates = [
    input.notes,
    input.Notes,
    input.CustomerNotes,
    input.customerNotes,
    input.ServiceNotes,
    input.serviceNotes,
    firstCustomer?.notes,
    firstCustomer?.Notes
  ]
    .map(cleanString)
    .filter(Boolean);

  const notes = noteCandidates.length > 0 ? Array.from(new Set(noteCandidates)).join('\n') : null;

  return {
    ms_bookings_email: msBookingsEmail,
    external_id: externalId,
    event_type: eventType,
    starts_at: startsAt,
    ends_at: endsAt,
    service_id: serviceId,
    service_name: serviceName,
    staff_id: staffId,
    staff_email: staffEmail,
    customer_email: customerEmail,
    customer_name: customerName,
    notes
  };
}

export function buildOutboxRssFeed(jobs = [], siteUrl = 'https://mind-black.github.io/MMI-LIMS/') {
  const nowRfc = new Date().toUTCString();
  const itemsXml = (jobs || [])
    .map((job) => {
      const payload = job.payload && typeof job.payload === 'object' ? job.payload : {};
      const itemTitle = payload.subject || `[MMI-LIMS #${job.booking_id ?? ''}] ${job.action || 'sync'}`;
      const jsonBody = JSON.stringify({
        job_id: job.id,
        lease: job.lease ?? null,
        ...payload
      });
      const pubDate = job.created_at ? new Date(job.created_at).toUTCString() : nowRfc;
      const itemLink = `${siteUrl}#ms-bookings-job-${job.id}`;

      return [
        '    <item>',
        `      <guid isPermaLink="false">${escapeXml(job.id)}</guid>`,
        `      <title>${escapeXml(itemTitle)}</title>`,
        `      <link>${escapeXml(itemLink)}</link>`,
        `      <description>${escapeXml(jsonBody)}</description>`,
        `      <pubDate>${escapeXml(pubDate)}</pubDate>`,
        '    </item>'
      ].join('\n');
    })
    .join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0">',
    '  <channel>',
    '    <title>MMI-LIMS Microsoft Bookings Sync Outbox</title>',
    `    <link>${escapeXml(siteUrl)}</link>`,
    '    <description>Pending MMI-LIMS reservation changes for Microsoft Bookings synchronization.</description>',
    `    <lastBuildDate>${escapeXml(nowRfc)}</lastBuildDate>`,
    itemsXml,
    '  </channel>',
    '</rss>'
  ]
    .filter(Boolean)
    .join('\n');
}

export function buildStatusRssFeed(title, payloadObj, siteUrl = 'https://mind-black.github.io/MMI-LIMS/') {
  const nowRfc = new Date().toUTCString();
  const guid = `${title}-${Date.now()}`;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0">',
    '  <channel>',
    `    <title>${escapeXml(title)}</title>`,
    `    <link>${escapeXml(siteUrl)}</link>`,
    `    <description>${escapeXml(title)}</description>`,
    `    <lastBuildDate>${escapeXml(nowRfc)}</lastBuildDate>`,
    '    <item>',
    `      <guid isPermaLink="false">${escapeXml(guid)}</guid>`,
    `      <title>${escapeXml(title)}</title>`,
    `      <link>${escapeXml(siteUrl)}</link>`,
    `      <description>${escapeXml(JSON.stringify(payloadObj ?? {}))}</description>`,
    `      <pubDate>${escapeXml(nowRfc)}</pubDate>`,
    '    </item>',
    '  </channel>',
    '</rss>'
  ].join('\n');
}
