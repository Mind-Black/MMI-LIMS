import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { zonedTimeToUtc } from 'https://esm.sh/date-fns-tz@2.0.0?deps=date-fns@2.30.0'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const LAB_TIMEZONE = 'Europe/Vilnius'

/**
 * Escapes text values for RFC 5545 compliance
 * Backslashes, semicolons, commas, and newlines must be escaped.
 */
export function escapeICSText(text: string | null | undefined): string {
    if (!text) return ''
    return String(text)
        .replace(/\\/g, '\\\\')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,')
        .replace(/\r?\n/g, '\\n')
}

/**
 * Folds ICS lines according to RFC 5545 (limit to 75 octets per line).
 * Lines are split and continued with CRLF + space.
 */
export function foldICSLine(line: string): string {
    const encoder = new TextEncoder()
    const bytes = encoder.encode(line)
    const maxOctets = 75

    if (bytes.length <= maxOctets) {
        return line
    }

    const decoder = new TextDecoder()
    let result = ''
    let start = 0
    let isFirst = true

    while (start < bytes.length) {
        const limit = isFirst ? maxOctets : maxOctets - 1
        let end = Math.min(start + limit, bytes.length)

        while (end > start && end < bytes.length && (bytes[end] & 0xC0) === 0x80) {
            end--
        }

        const chunkStr = decoder.decode(bytes.subarray(start, end))

        if (isFirst) {
            result = chunkStr
            isFirst = false
        } else {
            result += '\r\n ' + chunkStr
        }

        start = end
    }

    return result
}

/**
 * Formats a Date object as RFC 5545 UTC timestamp: YYYYMMDDTHHMMSSZ
 */
export function formatICSDateUTC(date: Date): string {
    return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
}

/**
 * Computes SHA-256 hash in hex format
 */
export async function sha256Hex(message: string): Promise<string> {
    const msgUint8 = new TextEncoder().encode(message)
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const url = new URL(req.url)
        const token = url.searchParams.get('token')

        if (!token || token.trim().length === 0) {
            return new Response(JSON.stringify({ error: 'Missing token' }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 400,
            })
        }

        // Initialize Supabase admin client to access protected calendar token lookup
        const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

        if (!supabaseUrl || !supabaseServiceKey) {
            console.error('Server configuration error: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
            return new Response(JSON.stringify({ error: 'Server configuration error' }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 500,
            })
        }

        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)

        // Compute SHA-256 of the presented bearer token (never store or query plaintext tokens)
        const tokenHash = await sha256Hex(token.trim())

        // Look up token owner in dedicated private table
        const { data: tokenRecord, error: tokenError } = await supabaseAdmin
            .from('user_calendar_tokens')
            .select('user_id')
            .eq('token_hash', tokenHash)
            .single()

        if (tokenError || !tokenRecord?.user_id) {
            return new Response(JSON.stringify({ error: 'Invalid or revoked calendar token' }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 401,
            })
        }

        const userId = tokenRecord.user_id

        // Fetch bookings for this owner with tool details
        const { data: bookings, error: bookingsError } = await supabaseAdmin
            .from('bookings')
            .select(`
                id,
                date,
                time,
                end_time,
                project,
                tools (
                    name,
                    location
                )
            `)
            .eq('user_id', userId)
            .order('date', { ascending: true })

        if (bookingsError) {
            console.error('Error fetching calendar bookings:', bookingsError)
            throw bookingsError
        }

        const now = new Date()
        const dtStamp = formatICSDateUTC(now)

        const lines: string[] = [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'PRODID:-//MMI-LIMS//Bookings Calendar//EN',
            'CALSCALE:GREGORIAN',
            'METHOD:PUBLISH',
            'X-WR-CALNAME:MMI-LIMS My Bookings',
            'X-WR-TIMEZONE:Europe/Vilnius',
        ]

        for (const booking of bookings ?? []) {
            try {
                const toolName = booking.tools?.name || 'Lab Equipment'
                const location = booking.tools?.location || 'Lab'
                const project = booking.project || 'General Research'

                // Handle missing or legacy end times (default to start + 30m)
                const startTimeStr = (booking.time || '09:00').slice(0, 5)
                let endTimeStr = (booking.end_time || '').slice(0, 5)

                if (!endTimeStr) {
                    const [h, m] = startTimeStr.split(':').map(Number)
                    const totalM = h * 60 + m + 30
                    const endH = Math.floor(totalM / 60) % 24
                    const endM = totalM % 60
                    endTimeStr = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`
                }

                // Construct ISO strings and parse in Europe/Vilnius lab timezone
                const startIso = `${booking.date}T${startTimeStr}:00`
                const endIso = `${booking.date}T${endTimeStr}:00`

                const startDate = zonedTimeToUtc(startIso, LAB_TIMEZONE)
                const endDate = zonedTimeToUtc(endIso, LAB_TIMEZONE)

                if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
                    console.warn(`Skipping booking ${booking.id} due to invalid date/time format: ${startIso} -> ${endIso}`)
                    continue
                }

                const uid = `booking-${booking.id}@mmi-lims.gradientfab.com`
                const summary = escapeICSText(`Booking: ${toolName}`)
                const description = escapeICSText(`Project: ${project}`)
                const loc = escapeICSText(location)

                lines.push('BEGIN:VEVENT')
                lines.push(`UID:${uid}`)
                lines.push(`DTSTAMP:${dtStamp}`)
                lines.push(`DTSTART:${formatICSDateUTC(startDate)}`)
                lines.push(`DTEND:${formatICSDateUTC(endDate)}`)
                lines.push(`SUMMARY:${summary}`)
                lines.push(`DESCRIPTION:${description}`)
                lines.push(`LOCATION:${loc}`)
                lines.push('STATUS:CONFIRMED')
                lines.push('END:VEVENT')
            } catch (err) {
                console.warn(`Error processing booking ${booking.id} for calendar:`, err)
            }
        }

        lines.push('END:VCALENDAR')

        // Fold lines per RFC 5545 and join with CRLF
        const icsContent = lines.map(foldICSLine).join('\r\n') + '\r\n'

        return new Response(icsContent, {
            headers: {
                ...corsHeaders,
                'Content-Type': 'text/calendar; charset=utf-8',
                'Content-Disposition': 'inline; filename="mmi-lims-bookings.ics"',
                'Cache-Control': 'private, no-cache, no-store, must-revalidate',
            },
        })

    } catch (error) {
        console.error('Error generating calendar:', error)
        return new Response(JSON.stringify({ error: 'Internal calendar error' }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 500,
        })
    }
})
