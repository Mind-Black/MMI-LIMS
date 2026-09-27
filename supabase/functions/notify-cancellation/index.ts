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

        // 3. Parse input
        const { toolId, toolName, bookingDate, bookingTime } = await req.json();

        if (!toolId || !toolName || !bookingDate || !bookingTime) {
            return new Response(
                JSON.stringify({ error: "Missing required fields: toolId, toolName, bookingDate, bookingTime" }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // 4. Verify tool exists in database
        const { data: toolRecord, error: toolError } = await supabaseAdmin
            .from('tools')
            .select('id, name')
            .eq('id', toolId)
            .single();

        if (toolError || !toolRecord) {
            return new Response(
                JSON.stringify({ error: "Invalid tool specified" }),
                { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // 5. Database-level recipient filtering for licensed & approved users
        // Query only approved users who have this toolId in their licenses array, excluding caller
        const { data: recipientProfiles, error: recipientsError } = await supabaseAdmin
            .from('profiles')
            .select('id')
            .eq('is_approved', true)
            .neq('id', user.id)
            .contains('licenses', [toolId])
            .limit(100); // Guard against unbounded fan-out

        if (recipientsError) {
            console.error("Error fetching licensed recipients:", recipientsError);
            throw recipientsError;
        }

        if (!recipientProfiles || recipientProfiles.length === 0) {
            return new Response(
                JSON.stringify({ success: true, count: 0, message: "No licensed users to notify" }),
                { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // 6. Look up emails from auth.users securely
        const emailList: string[] = [];
        for (const p of recipientProfiles) {
            const { data: userData, error: userError } = await supabaseAdmin.auth.admin.getUserById(p.id);
            if (!userError && userData?.user?.email) {
                emailList.push(userData.user.email);
            }
        }

        if (emailList.length === 0) {
            return new Response(
                JSON.stringify({ success: true, count: 0, message: "No recipient emails resolved" }),
                { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const callerName = `${callerProfile.first_name || ''} ${callerProfile.last_name || ''}`.trim() || user.email;
        const resend = new Resend(resendKey);

        // 7. Bounded concurrency email dispatch (chunks of 5)
        const CHUNK_SIZE = 5;
        let sentCount = 0;
        let failedCount = 0;

        const emailSubject = `[MMI-LIMS] Booking Cancellation: ${toolRecord.name}`;
        const emailText = `A booking for ${toolRecord.name} on ${bookingDate} at ${bookingTime} has been cancelled by ${callerName}.\n\nThis slot is now available for reservation.`;

        for (let i = 0; i < emailList.length; i += CHUNK_SIZE) {
            const chunk = emailList.slice(i, i + CHUNK_SIZE);
            const results = await Promise.allSettled(
                chunk.map(email =>
                    resend.emails.send({
                        from: "MMI-LIMS <no-reply@lims.gradientfab.com>",
                        to: email,
                        subject: emailSubject,
                        text: emailText,
                    })
                )
            );

            for (const r of results) {
                if (r.status === 'fulfilled' && !r.value.error) {
                    sentCount++;
                } else {
                    failedCount++;
                    const err = r.status === 'rejected' ? r.reason : r.value?.error;
                    console.warn("Failed sending cancellation notification to recipient:", err);
                }
            }
        }

        return new Response(
            JSON.stringify({
                success: true,
                count: sentCount,
                failed: failedCount,
                message: `Cancellation notifications processed (${sentCount} sent, ${failedCount} failed)`,
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );

    } catch (error) {
        console.error('Error in notify-cancellation:', error);
        return new Response(
            JSON.stringify({ error: error.message || "Failed to notify recipients" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
});
