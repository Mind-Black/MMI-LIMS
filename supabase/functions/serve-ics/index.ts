import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { zonedTimeToUtc } from 'https://esm.sh/date-fns-tz@2.0.0?deps=date-fns@2.30.0'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const LAB_TIMEZONE = 'Europe/Vilnius'

/**
 * Escapes text values for RFC 5545 compliance.
 * Backslashes, semicolons, commas, and newlines must be escaped.
 * Handles CRLF, bare CR, and bare LF (Fixes R13).
 */
export function escapeICSText(text: string | null | undefined): string {
    if (!text) return ''
    return String(text)
        .replace(/\\/g, '\\\\')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,')
        .replace(/\r\n|\r|\n/g, '\\n')
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

        // 1. Hash the incoming bearer token using SHA-256
        const tokenHash = await sha256Hex(token.trim())

        // 2. Validate token hash against the isolated user_calendar_tokens table
        const { data: tokenRow, error: tokenError } = await supabaseAdmin
            .from('user_calendar_tokens')
            .select('user_id')
            .eq('token_hash', tokenHash)
            .single()

        if (tokenError || !tokenRow) {
            return new Response(JSON.stringify({ error: 'Invalid or revoked calendar token' }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 401,
            })
        }

        // 3. Define feed horizon (-60 days past, +365 days future) (Fixes R5)
        const now = new Date()
        const pastHorizon = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
        const futureHorizon = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

        // 4. Query bookings for this authenticated user within the horizon
        const { data: bookings, error: bookingsError } = await supabaseAdmin
            .from('bookings')
            .select('id, user_id, project, date, time, end_time, starts_at, ends_at, tools ( name, location )')
            .eq('user_id', tokenRow.user_id)
            .gte('date', pastHorizon)
            .lte('date', futureHorizon)
            .order('date', { ascending: true })
            .order('time', { ascending: true })
            .order('id', { ascending: true })
            .limit(2000)

        if (bookingsError) {
            console.error('Database query error fetching calendar bookings:', bookingsError)
            return new Response(JSON.stringify({ error: 'Failed to retrieve bookings' }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 500,
            })
        }

        // 5. Generate RFC 5545 iCalendar stream
        const dtStamp = formatICSDateUTC(new Date())
        const lines: string[] = [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'PRODID:-//MMI-LIMS//Calendar Feed//EN',
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

                let startDate: Date
                let endDate: Date

                if (booking.starts_at && booking.ends_at) {
                    startDate = new Date(booking.starts_at)
                    endDate = new Date(booking.ends_at)
                } else {
                    // Legacy calculation with Europe/Vilnius parsing
                    const startTimeStr = (booking.time || '09:00').slice(0, 5)
                    const startIso = `${booking.date}T${startTimeStr}:00`
                    startDate = zonedTimeToUtc(startIso, LAB_TIMEZONE)

                    if (booking.end_time) {
                        const endTimeStr = booking.end_time.slice(0, 5)
                        if (endTimeStr > startTimeStr) {
                            const endIso = `${booking.date}T${endTimeStr}:00`
                            endDate = zonedTimeToUtc(endIso, LAB_TIMEZONE)
                        } else {
                            // Rollover to next day
                            endDate = new Date(startDate.getTime() + 30 * 60 * 1000)
                        }
                    } else {
                        // Default 30m slot
                        endDate = new Date(startDate.getTime() + 30 * 60 * 1000)
                    }
                }

                if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
                    console.warn(`Skipping booking ${booking.id} due to invalid timestamps`)
                    continue
                }

                const uid = `booking-${booking.id}@mmi-lims.local`
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
            } catch (eventErr) {
                console.error(`Error formatting calendar event for booking ${booking.id}:`, eventErr)
            }
        }

        lines.push('END:VCALENDAR')

        // Apply RFC 5545 line folding and CRLF formatting
        const icsContent = lines.map(foldICSLine).join('\r\n') + '\r\n'

        return new Response(icsContent, {
            headers: {
                ...corsHeaders,
                'Content-Type': 'text/calendar; charset=utf-8',
                'Content-Disposition': 'attachment; filename="mmi-lims-bookings.ics"',
                'Cache-Control': 'no-cache, no-store, max-age=0, must-revalidate',
            },
            status: 200,
        })
    } catch (error) {
        console.error('Unexpected error in serve-ics:', error)
        return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 500,
        })
    }
})
