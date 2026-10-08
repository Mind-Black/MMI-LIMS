import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { Resend } from "npm:resend@2.0.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        const resendKey = Deno.env.get("RESEND_API_KEY");
        const sbUrl = Deno.env.get("SUPABASE_URL");
        const sbKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

        if (!resendKey || !sbUrl || !sbKey) {
            return new Response(
                JSON.stringify({ error: "Server configuration missing" }),
                { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // 1. Authenticate the caller
        const authHeader = req.headers.get('Authorization');
        if (!authHeader) {
            return new Response(
                JSON.stringify({ error: "Missing Authorization header" }),
                { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const supabaseClient = createClient(
            sbUrl,
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

        const supabaseAdmin = createClient(sbUrl, sbKey);

        // 2. Verify caller is approved
        const { data: callerProfile, error: profileError } = await supabaseAdmin
            .from('profiles')
            .select('first_name, last_name, is_approved, access_level')
            .eq('id', user.id)
            .single();

        if (profileError || !callerProfile || !callerProfile.is_approved) {
            return new Response(
                JSON.stringify({ error: "Forbidden: Account not approved" }),
                { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const isCallerAdmin = callerProfile.access_level === 'admin';

        // 3. Parse input
        const body = await req.json().catch(() => ({}));
        const { cancellationEventId } = body;

        let toolId: number | string;
        let toolName: string;
        let bookingDate: string;
        let bookingTime: string;

        if (cancellationEventId) {
            // R4: Fetch verified committed cancellation event
            const { data: eventRecord, error: eventError } = await supabaseAdmin
                .from('cancellation_events')
                .select('*')
                .eq('id', cancellationEventId)
                .single();

            if (eventError || !eventRecord) {
                return new Response(
                    JSON.stringify({ error: "Cancellation event not found" }),
                    { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
            }

            // Anti-replay check
            if (eventRecord.notified) {
                return new Response(
                    JSON.stringify({ error: "Notification has already been sent for this cancellation" }),
                    { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
            }

            // Verify authority over event
            if (eventRecord.cancelled_by !== user.id && !isCallerAdmin) {
                return new Response(
                    JSON.stringify({ error: "Forbidden: unauthorized to notify for this cancellation" }),
                    { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
            }

            toolId = eventRecord.tool_id;
            toolName = eventRecord.tool_name;
            bookingDate = eventRecord.date;
            bookingTime = eventRecord.time;

            // Mark notified immediately to prevent race replays
            await supabaseAdmin
                .from('cancellation_events')
                .update({ notified: true, notified_at: new Date().toISOString() })
                .eq('id', cancellationEventId);
        } else {
            // Fallback for legacy calls (requires toolId, toolName, bookingDate, bookingTime)
            if (!body.toolId || !body.toolName || !body.bookingDate || !body.bookingTime) {
                return new Response(
                    JSON.stringify({ error: "Missing required cancellationEventId or booking details" }),
                    { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
            }
            toolId = body.toolId;
            toolName = String(body.toolName).slice(0, 100);
            bookingDate = String(body.bookingDate).slice(0, 10);
            bookingTime = String(body.bookingTime).slice(0, 10);
        }

        // 4. Paginated recipient query (Fixes R13)
        const recipientUserIds: string[] = [];
        const pageSize = 100;
        let page = 0;
        const maxRecipients = 500;

        while (recipientUserIds.length < maxRecipients) {
            const { data: pageRows, error: pageErr } = await supabaseAdmin
                .from('profiles')
                .select('id')
                .eq('is_approved', true)
                .neq('id', user.id)
                .contains('licenses', [toolId.toString()])
                .range(page * pageSize, (page + 1) * pageSize - 1);

            if (pageErr || !pageRows || pageRows.length === 0) break;
            for (const r of pageRows) {
                recipientUserIds.push(r.id);
            }
            if (pageRows.length < pageSize) break;
            page++;
        }

        if (recipientUserIds.length === 0) {
            return new Response(
                JSON.stringify({ message: "No eligible recipients found", sentCount: 0, failedCount: 0, totalRecipients: 0 }),
                { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // 5. Look up recipient email addresses in batches
        const emails: string[] = [];
        const batchLookupSize = 25;
        for (let i = 0; i < recipientUserIds.length; i += batchLookupSize) {
            const chunk = recipientUserIds.slice(i, i + batchLookupSize);
            const results = await Promise.all(
                chunk.map(id => supabaseAdmin.auth.admin.getUserById(id))
            );
            for (const res of results) {
                if (res.data?.user?.email) {
                    emails.push(res.data.user.email);
                }
            }
        }

        if (emails.length === 0) {
            return new Response(
                JSON.stringify({ message: "No recipient emails resolved", sentCount: 0, failedCount: 0, totalRecipients: recipientUserIds.length }),
                { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // 6. Send emails in bounded concurrency batches of 5
        const resend = new Resend(resendKey);
        const senderName = callerProfile.first_name ? `${callerProfile.first_name} ${callerProfile.last_name || ''}`.trim() : 'A lab member';
        let sentCount = 0;
        let failedCount = 0;

        const emailConcurrency = 5;
        const senderEmail = Deno.env.get("SENDER_EMAIL") || "MMI-LIMS <noreply@example.com>";
        const appUrl = Deno.env.get("APP_URL") || "/";
        for (let i = 0; i < emails.length; i += emailConcurrency) {
            const batch = emails.slice(i, i + emailConcurrency);
            const sendPromises = batch.map(async (email) => {
                try {
                    const result = await resend.emails.send({
                        from: senderEmail,
                        to: email,
                        subject: `Slot Available: ${toolName}`,
                        html: `
                            <p>Hello,</p>
                            <p>A slot has just become available for <strong>${toolName}</strong> on <strong>${bookingDate}</strong> at <strong>${bookingTime}</strong>.</p>
                            <p>Cancelled by: ${senderName}</p>
                            <p><a href="${appUrl}">Click here to book this slot</a></p>
                        `,
                    });
                    if (result.error) {
                        console.error(`Resend error sending to ${email}:`, result.error);
                        failedCount++;
                    } else {
                        sentCount++;
                    }
                } catch (sendErr) {
                    console.error(`Exception sending cancellation notice to ${email}:`, sendErr);
                    failedCount++;
                }
            });
            await Promise.all(sendPromises);
        }

        return new Response(
            JSON.stringify({
                message: `Cancellation broadcast complete`,
                sentCount,
                failedCount,
                totalRecipients: emails.length
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );

    } catch (error) {
        console.error("Unexpected error in notify-cancellation:", error);
        return new Response(
            JSON.stringify({ error: error.message || "Internal server error" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
});
