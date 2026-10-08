import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { Resend } from "npm:resend@2.0.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function escapeHtml(str: string): string {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

serve(async (req) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        const resendKey = Deno.env.get("RESEND_API_KEY");
        const supabaseUrl = Deno.env.get("SUPABASE_URL");
        const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

        if (!resendKey || !supabaseUrl || !supabaseServiceKey) {
            return new Response(
                JSON.stringify({ error: "Email service not configured" }),
                { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // 1. Authenticate caller via JWT
        const authHeader = req.headers.get('Authorization');
        if (!authHeader) {
            return new Response(
                JSON.stringify({ error: "Missing Authorization header" }),
                { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const supabaseClient = createClient(
            supabaseUrl,
            Deno.env.get("SUPABASE_ANON_KEY") ?? "",
            { global: { headers: { Authorization: authHeader } } }
        );

        const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
        if (authError || !user) {
            return new Response(
                JSON.stringify({ error: "Unauthorized" }),
                { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

        // 2. Verify sender is an approved user
        const { data: senderProfile, error: senderError } = await supabaseAdmin
            .from('profiles')
            .select('first_name, last_name, job_title, is_approved, access_level')
            .eq('id', user.id)
            .single();

        if (senderError || !senderProfile || !senderProfile.is_approved) {
            return new Response(
                JSON.stringify({ error: "Forbidden: Account is not approved" }),
                { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // 3. Parse and validate request payload
        const payload = await req.json();
        const { bookingId, subject, message } = payload;

        if (!bookingId || !subject || !message) {
            return new Response(
                JSON.stringify({ error: "Missing required fields: bookingId, subject, message" }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // Enforce strict bounds on user message content
        const cleanSubject = String(subject).trim();
        const cleanMessage = String(message).trim();

        if (cleanSubject.length === 0 || cleanSubject.length > 150) {
            return new Response(
                JSON.stringify({ error: "Subject must be between 1 and 150 characters" }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        if (cleanMessage.length === 0 || cleanMessage.length > 3000) {
            return new Response(
                JSON.stringify({ error: "Message must be between 1 and 3000 characters" }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // 4. Enforce sender quota: max 20 emails per hour (Fixes R4)
        if (senderProfile.access_level !== 'admin') {
            const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
            const { count: recentCount, error: countErr } = await supabaseAdmin
                .from('email_logs')
                .select('*', { count: 'exact', head: true })
                .eq('sender_id', user.id)
                .gte('created_at', oneHourAgo);

            if (!countErr && (recentCount ?? 0) >= 20) {
                return new Response(
                    JSON.stringify({ error: "Email rate limit exceeded (maximum 20 per hour). Please try again later." }),
                    { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
            }
        }

        // 5. Derive recipient and booking details authoritatively from database
        const { data: booking, error: bookingError } = await supabaseAdmin
            .from('bookings')
            .select(`
                id,
                user_id,
                date,
                time,
                end_time,
                project,
                tools (
                    name,
                    location
                )
            `)
            .eq('id', bookingId)
            .single();

        if (bookingError || !booking) {
            return new Response(
                JSON.stringify({ error: "Referenced booking not found" }),
                { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // Retrieve recipient user record from auth.users (service role)
        const { data: recipientAuth, error: recipientError } = await supabaseAdmin.auth.admin.getUserById(booking.user_id);
        if (recipientError || !recipientAuth?.user?.email) {
            return new Response(
                JSON.stringify({ error: "Booking owner email unavailable" }),
                { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const recipientEmail = recipientAuth.user.email;
        const senderName = `${senderProfile.first_name || ''} ${senderProfile.last_name || ''}`.trim() || user.email;
        const toolName = booking.tools?.name || 'Lab Equipment';

        // 6. Construct safe email contents with escaping (no arbitrary raw HTML accepted)
        const escapedSubject = `[MMI-LIMS] ${cleanSubject}`;
        const plainText = [
            `Hello,`,
            ``,
            `You have received a message regarding your booking for ${toolName} on ${booking.date} at ${booking.time}:`,
            ``,
            `--------------------------------------------------`,
            cleanMessage,
            `--------------------------------------------------`,
            ``,
            `Sent by: ${senderName} (${senderProfile.job_title || 'User'})`,
            `MMI Laboratory Information Management System`,
        ].join('\n');

        const htmlBody = `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e5e7eb; rounded: 8px;">
                <h3 style="color: #1e3a8a; margin-top: 0;">MMI-LIMS Booking Notification</h3>
                <p>You have received a message regarding your reservation for <strong>${escapeHtml(toolName)}</strong> on <strong>${escapeHtml(booking.date)}</strong> at <strong>${escapeHtml(booking.time)}</strong>.</p>
                <div style="background-color: #f3f4f6; border-left: 4px solid #3b82f6; padding: 12px 16px; margin: 20px 0; border-radius: 4px;">
                    <p style="margin: 0; white-space: pre-wrap; color: #1f2937;">${escapeHtml(cleanMessage)}</p>
                </div>
                <p style="color: #6b7280; font-size: 13px; margin-bottom: 0;">
                    Sent by: <strong>${escapeHtml(senderName)}</strong> (${escapeHtml(senderProfile.job_title || 'Researcher')})<br>
                    Materials Research Facility
                </p>
            </div>
        `;

        // 7. Send email via Resend and handle provider outcome
        const resend = new Resend(resendKey);
        const senderEmail = Deno.env.get("SENDER_EMAIL") || "MMI-LIMS <no-reply@example.com>";
        const { data: resendData, error: resendError } = await resend.emails.send({
            from: senderEmail,
            to: recipientEmail,
            reply_to: user.email,
            subject: escapedSubject,
            text: plainText,
            html: htmlBody,
        });

        if (resendError) {
            console.error("Resend provider error:", resendError);
            return new Response(
                JSON.stringify({ error: "Failed to send email via provider", details: resendError.message }),
                { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // Record successful send for rate limiting
        await supabaseAdmin.from('email_logs').insert({
            sender_id: user.id,
            recipient_email: recipientEmail,
            booking_id: booking.id,
        });

        return new Response(
            JSON.stringify({ success: true, messageId: resendData?.id }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );

    } catch (error) {
        console.error("Unexpected error in send-email:", error);
        return new Response(
            JSON.stringify({ error: "Internal server error" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
});
