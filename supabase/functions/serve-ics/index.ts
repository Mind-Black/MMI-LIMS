import {fetchAllById} from '../_shared/pagination.js';
import {platformKey} from '../_shared/config.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.86.0'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}


import { escapeICSText, foldICSLine, formatICSDateUTC, sha256Hex } from '../_shared/ics.js'

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
        const supabaseServiceKey = platformKey('secret')

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

        const { data: profile, error: profileError } = await supabaseAdmin.from('profiles').select('is_approved').eq('id', tokenRow.user_id).single()
        if (profileError || !profile?.is_approved) return new Response('Access revoked', {status: 403})
        // 3. Define feed horizon (-60 days past, +365 days future) (Fixes R5)
        const now = new Date()
        const pastHorizon = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
        const futureHorizon = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

        // 4. Query bookings for this authenticated user within the horizon
        const bookings = await fetchAllById(() => supabaseAdmin
            .from('bookings')
            .select('id, user_id, project, date, time, end_time, starts_at, ends_at, tools ( name, location )')
            .eq('user_id', tokenRow.user_id)
            .gte('date', pastHorizon)
            .lte('date', futureHorizon))

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
                    throw new Error('Booking lacks canonical timestamps')
                }

                if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
                    console.warn(`Skipping booking ${booking.id} due to invalid timestamps`)
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
