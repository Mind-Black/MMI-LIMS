import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { Resend } from "npm:resend@2.0.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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
            throw new Error("Missing server configuration (env vars)");
        }

        const resend = new Resend(resendKey);
        const { toolId, toolName, bookingDate, bookingTime, cancelledByName, senderId } = await req.json();

        if (!toolId || !toolName || !bookingDate || !bookingTime) {
            return new Response(
                JSON.stringify({ error: "Missing required fields" }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

        // 1. Fetch all profiles that have the relevant license
        // We fetch 'id' and 'licenses' to filter programmatically
        const { data: profiles, error: profileError } = await supabaseAdmin
            .from('profiles')
            .select('id, licenses');

        if (profileError) {
            throw profileError;
        }

        // 2. Filter for users who have the license and are not the sender
        const recipientProfiles = profiles.filter(p => {
            if (p.id === senderId) return false;
            if (!p.licenses || !Array.isArray(p.licenses)) return false;
            // Loose equality check for toolId (supports both string and int)
            return p.licenses.some(lic => lic == toolId);
        });

        if (recipientProfiles.length === 0) {
            return new Response(
                JSON.stringify({ message: "No recipients found", count: 0 }),
                { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // 3. Securely fetch email addresses from Auth system for these users
        const emailLookupPromises = recipientProfiles.map(async (p) => {
            const { data: userData, error: userError } = await supabaseAdmin.auth.admin.getUserById(p.id);
            if (userError || !userData?.user?.email) {
                console.error(`Could not find email for user ${p.id}`, userError);
                return null;
            }
            return userData.user.email;
        });

        const recipients = (await Promise.all(emailLookupPromises)).filter(email => email !== null);

        if (recipients.length === 0) {
            return new Response(
                JSON.stringify({ message: "No recipients found (emails unavailable)", count: 0 }),
                { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // 4. Send emails via Resend
        const emailPromises = recipients.map(email => {
            return resend.emails.send({
                from: "MMI-LIMS <no-reply@lims.gradientfab.com>",
                to: email,
                subject: `[MMI-LIMS] Booking Cancellation: ${toolName}`,
                text: `A booking for ${toolName} on ${bookingDate} at ${bookingTime} has been cancelled by ${cancelledByName}.\n\nThis slot is now available.`
            });
        });

        await Promise.all(emailPromises);

        return new Response(
            JSON.stringify({ message: "Notifications processed", count: recipients.length }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );

    } catch (error) {
        console.error('Error in notify-cancellation:', error);
        return new Response(
            JSON.stringify({ error: error.message }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
});
