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
    // Handle CORS preflight request
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        const { to, userId, subject, html, text } = await req.json();

        if ((!to && !userId) || !subject || (!html && !text)) {
            return new Response(
                JSON.stringify({ error: "Missing required fields: to (or userId), subject, html/text" }),
                {
                    status: 400,
                    headers: { ...corsHeaders, "Content-Type": "application/json" },
                }
            );
        }

        let recipientEmail = to;

        // If userId is provided but no email, fetch it
        if (!recipientEmail && userId) {
            const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

            // Try fetching from auth.users first (more reliable for emails)
            // Note: auth.users is not directly queryable via standard client usually, 
            // but service role can via auth.admin.getUserById
            const { data: userData, error: userError } = await supabaseAdmin.auth.admin.getUserById(userId);

            if (!userError && userData?.user?.email) {
                recipientEmail = userData.user.email;
            } else {
                // Fallback to profiles table
                const { data: profileData, error: profileError } = await supabaseAdmin
                    .from('profiles')
                    .select('email')
                    .eq('id', userId)
                    .single();

                if (profileError || !profileData?.email) {
                    throw new Error(`Could not find email for userId: ${userId}`);
                }
                recipientEmail = profileData.email;
            }
        }

        const data = await resend.emails.send({
            from: "MMI-LIMS <onboarding@resend.dev>", // Update this if you have a custom domain
            to: recipientEmail,
            subject: subject,
            html: html,
            text: text,
        });

        return new Response(JSON.stringify(data), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 200,
        });
    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 500,
        });
    }
});
