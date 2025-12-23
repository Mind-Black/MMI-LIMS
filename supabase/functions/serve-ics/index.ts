import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { zonedTimeToUtc } from 'https://esm.sh/date-fns-tz@2.0.0?deps=date-fns@2.30.0'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const TIMEZONE = 'Europe/Vilnius'

Deno.serve(async (req) => {
    // Handle CORS preflight requests
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const url = new URL(req.url)
        const token = url.searchParams.get('token')

        if (!token) {
            return new Response(JSON.stringify({ error: 'Missing token' }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 400,
            })
        }

        // Initialize Supabase client
        const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
        const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
        const supabase = createClient(supabaseUrl, supabaseAnonKey)

        // Find user by token
        const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('id')
            .eq('calendar_token', token)
            .single()

        if (profileError || !profile) {
            return new Response(JSON.stringify({ error: 'Invalid token' }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 401,
            })
        }

        const userId = profile.id

        // Fetch bookings for the user
        // We also fetch tool details to make the event title descriptive
        const { data: bookings, error: bookingsError } = await supabase
            .from('bookings')
            .select(`
        *,
        tools (
          name,
          location
        )
      `)
            .eq('user_id', userId)

        if (bookingsError) {
            throw bookingsError
        }

        // Generate ICS content
        let icsContent = [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'PRODID:-//MMI-LIMS//Bookings//EN',
            'CALSCALE:GREGORIAN',
            'METHOD:PUBLISH',
            'X-WR-CALNAME:MMI-LIMS Bookings',
            'X-WR-TIMEZONE:UTC',
        ].join('\r\n') + '\r\n'

        bookings.forEach((booking) => {
            const toolName = booking.tools?.name || 'Unknown Tool'
            const location = booking.tools?.location || 'Lab'

            // Construct date string: YYYY-MM-DDTHH:MM:SS
            const startDateStr = `${booking.date}T${booking.time || booking.startTime}`
            const endDateStr = `${booking.date}T${booking.end_time || booking.endTime}`

            // Convert Vilnius time to UTC Date object
            const startDateTime = zonedTimeToUtc(startDateStr, TIMEZONE)
            const endDateTime = zonedTimeToUtc(endDateStr, TIMEZONE)

            const formatICSDate = (date: Date) => {
                return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
            }

            const now = new Date()
            const dtStamp = formatICSDate(now)
            const dtStart = formatICSDate(startDateTime)
            const dtEnd = formatICSDate(endDateTime)

            const uid = `${booking.id}@mmi-lims`

            const event = [
                'BEGIN:VEVENT',
                `UID:${uid}`,
                `DTSTAMP:${dtStamp}`,
                `DTSTART:${dtStart}`,
                `DTEND:${dtEnd}`,
                `SUMMARY:Booking: ${toolName}`,
                `DESCRIPTION:Project: ${booking.project}`,
                `LOCATION:${location}`,
                'STATUS:CONFIRMED',
                'END:VEVENT',
            ].join('\r\n') + '\r\n'

            icsContent += event
        })

        icsContent += 'END:VCALENDAR'

        return new Response(icsContent, {
            headers: {
                ...corsHeaders,
                'Content-Type': 'text/calendar; charset=utf-8',
                'Content-Disposition': 'attachment; filename="bookings.ics"',
            },
        })

    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 400,
        })
    }
})
