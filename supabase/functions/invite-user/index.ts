import { platformKey } from '../_shared/config.ts';
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.86.0';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
}

function escapeHtml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function generateTokenHex(): string {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(input: string): Promise<string> {
    const data = new TextEncoder().encode(input);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
}

function normalizeEmail(raw: unknown): string {
    return String(raw ?? '').trim().toLowerCase();
}

function isValidEmail(email: string): boolean {
    return email.length >= 3 && email.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function sanitizeOptionalText(raw: unknown, maxLen = 100): string | null {
    const val = String(raw ?? '').trim();
    if (!val) return null;
    return val.slice(0, maxLen);
}

function sanitizeProjects(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    const result: string[] = [];
    for (const item of raw) {
        const clean = String(item ?? '').trim();
        if (clean.length >= 1 && clean.length <= 100 && !seen.has(clean)) {
            seen.add(clean);
            result.push(clean);
        }
    }
    return result.slice(0, 50);
}

async function sendInvitationEmail({
    resendKey,
    recipientEmail,
    inviterName,
    firstName,
    inviteUrl,
    expiresAtIso,
}: {
    resendKey: string;
    recipientEmail: string;
    inviterName: string;
    firstName: string | null;
    inviteUrl: string;
    expiresAtIso: string;
}): Promise<string | undefined> {
    const greeting = firstName ? `Hello ${firstName},` : 'Hello,';
    const expiryDate = expiresAtIso.slice(0, 10);

    const plainText = [
        greeting,
        '',
        `${inviterName} has invited you to join MMI-LIMS (Institute of Materials Science).`,
        '',
        'Click the link below to complete your account setup and choose a password:',
        inviteUrl,
        '',
        `This invitation expires on ${expiryDate}.`,
        '',
        'MMI Laboratory Information Management System',
    ].join('\n');

    const htmlBody = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 8px;">
            <h2 style="color: #1e3a8a; margin-top: 0;">You're Invited to MMI-LIMS</h2>
            <p style="color: #1f2937;">${escapeHtml(greeting)}</p>
            <p style="color: #1f2937;">
                <strong>${escapeHtml(inviterName)}</strong> has invited you to create an account on the
                <strong>MMI-LIMS</strong> Laboratory Information Management System.
            </p>
            <div style="margin: 28px 0; text-align: center;">
                <a href="${escapeHtml(inviteUrl)}"
                   style="display: inline-block; background-color: #1d4ed8; color: #ffffff; font-weight: 600; text-decoration: none; padding: 12px 24px; border-radius: 6px;">
                    Accept Invitation &amp; Set Password
                </a>
            </div>
            <p style="color: #4b5563; font-size: 13px;">
                Or copy and paste this link into your browser:<br>
                <a href="${escapeHtml(inviteUrl)}" style="color: #1d4ed8; word-break: break-all;">${escapeHtml(inviteUrl)}</a>
            </p>
            <p style="color: #6b7280; font-size: 12px; margin-bottom: 0; border-top: 1px solid #e5e7eb; padding-top: 12px;">
                This invitation expires on ${escapeHtml(expiryDate)}. Your account will be automatically approved once you complete registration.
            </p>
        </div>
    `;

    const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${resendKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            from: Deno.env.get('EMAIL_FROM') || 'MMI-LIMS <no-reply@lims.gradientfab.com>',
            to: recipientEmail,
            subject: '[MMI-LIMS] You are invited to join the laboratory booking system',
            text: plainText,
            html: htmlBody,
        }),
        signal: AbortSignal.timeout(15000),
    });

    const resendData = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(resendData?.message || `Email provider returned ${response.status}`);
    }
    return resendData?.id;
}

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }
    if (req.method !== 'POST') {
        return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL');
        const supabaseServiceKey = platformKey('secret');
        const resendKey = Deno.env.get('RESEND_API_KEY');

        if (!supabaseUrl || !supabaseServiceKey) {
            return jsonResponse({ error: 'Server configuration incomplete' }, 500);
        }

        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
        const payload = await req.json();
        const action = payload?.action;

        if (action === 'accept') {
            const rawToken = String(payload?.token ?? '').trim();
            const password = String(payload?.password ?? '');
            const firstName = sanitizeOptionalText(payload?.first_name, 100);
            const lastName = sanitizeOptionalText(payload?.last_name, 100);
            const jobTitle = sanitizeOptionalText(payload?.job_title, 100);

            if (!/^[0-9a-f]{64}$/.test(rawToken)) {
                return jsonResponse({ error: 'Invalid invitation token' }, 400);
            }
            if (password.length < 8 || password.length > 256) {
                return jsonResponse({ error: 'Password must be at least 8 characters' }, 400);
            }
            if (!firstName || !lastName || !jobTitle) {
                return jsonResponse({ error: 'First name, last name, and job title are required' }, 400);
            }

            const tokenHash = await sha256Hex(rawToken);
            const { data: invite, error: inviteError } = await supabaseAdmin
                .from('user_invitations')
                .select('id, email, status, expires_at')
                .eq('token_hash', tokenHash)
                .eq('status', 'pending')
                .gt('expires_at', new Date().toISOString())
                .maybeSingle();

            if (inviteError || !invite) {
                return jsonResponse({ error: 'This invitation is invalid, expired, or has already been used' }, 404);
            }

            const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
                email: invite.email,
                password,
                email_confirm: true,
                user_metadata: {
                    first_name: firstName,
                    last_name: lastName,
                    job_title: jobTitle,
                },
            });

            if (createError || !created?.user) {
                const msg = createError?.message || 'Could not create user account';
                const status = /already/i.test(msg) ? 409 : 400;
                return jsonResponse({ error: msg }, status);
            }

            return jsonResponse({
                success: true,
                email: invite.email,
                userId: created.user.id,
            });
        }

        // Admin-only actions: 'send' and 'resend'
        if (!resendKey) {
            return jsonResponse({ error: 'Email service not configured' }, 500);
        }

        const authHeader = req.headers.get('Authorization');
        if (!authHeader) {
            return jsonResponse({ error: 'Missing Authorization header' }, 401);
        }

        const supabaseClient = createClient(
            supabaseUrl,
            platformKey('publishable'),
            { global: { headers: { Authorization: authHeader } } }
        );

        const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
        if (authError || !user) {
            return jsonResponse({ error: 'Unauthorized' }, 401);
        }

        const { data: adminProfile, error: profileError } = await supabaseAdmin
            .from('profiles')
            .select('first_name, last_name, is_approved, access_level')
            .eq('id', user.id)
            .single();

        if (profileError || !adminProfile || !adminProfile.is_approved || adminProfile.access_level !== 'admin') {
            return jsonResponse({ error: 'Forbidden: Administrator access required' }, 403);
        }

        const inviterName = `${adminProfile.first_name || ''} ${adminProfile.last_name || ''}`.trim() || user.email || 'Administrator';
        const siteUrl = (Deno.env.get('SITE_URL') || 'https://mind-black.github.io/MMI-LIMS/').replace(/\/?$/, '/');

        if (action === 'send') {
            const email = normalizeEmail(payload?.email);
            if (!isValidEmail(email)) {
                return jsonResponse({ error: 'Please provide a valid email address' }, 400);
            }

            const firstName = sanitizeOptionalText(payload?.first_name, 100);
            const lastName = sanitizeOptionalText(payload?.last_name, 100);
            const jobTitle = sanitizeOptionalText(payload?.job_title, 100);
            const projects = sanitizeProjects(payload?.projects);

            // Reject if a user with this email already exists in profiles
            const { data: existingProfile } = await supabaseAdmin
                .from('profiles')
                .select('id')
                .ilike('email', email)
                .maybeSingle();

            if (existingProfile) {
                return jsonResponse({ error: 'A user with this email address is already registered' }, 409);
            }

            // Expire any stale pending invitation for the same email, or reject if an active one exists
            const { data: existingInvite } = await supabaseAdmin
                .from('user_invitations')
                .select('id, expires_at')
                .eq('email', email)
                .eq('status', 'pending')
                .maybeSingle();

            if (existingInvite) {
                if (new Date(existingInvite.expires_at).getTime() > Date.now()) {
                    return jsonResponse({ error: 'An active pending invitation already exists for this email' }, 409);
                }
                await supabaseAdmin
                    .from('user_invitations')
                    .update({ status: 'revoked' })
                    .eq('id', existingInvite.id);
            }

            const rawToken = generateTokenHex();
            const tokenHash = await sha256Hex(rawToken);
            const nowIso = new Date().toISOString();
            const expiresAtIso = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

            const { data: inserted, error: insertError } = await supabaseAdmin
                .from('user_invitations')
                .insert({
                    email,
                    token_hash: tokenHash,
                    first_name: firstName,
                    last_name: lastName,
                    job_title: jobTitle,
                    projects,
                    invited_by: user.id,
                    status: 'pending',
                    expires_at: expiresAtIso,
                    last_sent_at: nowIso,
                })
                .select('id, email, first_name, last_name, job_title, projects, status, expires_at, last_sent_at, created_at')
                .single();

            if (insertError || !inserted) {
                return jsonResponse({ error: insertError?.message || 'Failed to create invitation' }, 500);
            }

            const inviteUrl = `${siteUrl}?invite=${rawToken}`;
            try {
                const messageId = await sendInvitationEmail({
                    resendKey,
                    recipientEmail: email,
                    inviterName,
                    firstName,
                    inviteUrl,
                    expiresAtIso,
                });

                await supabaseAdmin.from('email_logs').insert({
                    sender_id: user.id,
                    recipient_email: email,
                    booking_id: null,
                });

                return jsonResponse({ success: true, invitation: inserted, messageId });
            } catch (emailErr) {
                // Roll back the pending invitation if initial email dispatch failed
                await supabaseAdmin.from('user_invitations').delete().eq('id', inserted.id);
                console.error('Invitation email dispatch failed:', emailErr);
                return jsonResponse({ error: 'Failed to send invitation email via provider' }, 502);
            }
        }

        if (action === 'resend') {
            const invitationId = String(payload?.invitationId ?? '').trim();
            if (!invitationId) {
                return jsonResponse({ error: 'Missing invitationId' }, 400);
            }

            const { data: existing, error: fetchError } = await supabaseAdmin
                .from('user_invitations')
                .select('id, email, first_name, status')
                .eq('id', invitationId)
                .single();

            if (fetchError || !existing) {
                return jsonResponse({ error: 'Invitation not found' }, 404);
            }
            if (existing.status !== 'pending') {
                return jsonResponse({ error: 'Only pending invitations can be resent' }, 400);
            }

            const rawToken = generateTokenHex();
            const tokenHash = await sha256Hex(rawToken);
            const nowIso = new Date().toISOString();
            const expiresAtIso = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

            const { data: updated, error: updateError } = await supabaseAdmin
                .from('user_invitations')
                .update({
                    token_hash: tokenHash,
                    last_sent_at: nowIso,
                    expires_at: expiresAtIso,
                })
                .eq('id', invitationId)
                .eq('status', 'pending')
                .select('id, email, first_name, last_name, job_title, projects, status, expires_at, last_sent_at, created_at')
                .single();

            if (updateError || !updated) {
                return jsonResponse({ error: 'Failed to update invitation for resend' }, 500);
            }

            const inviteUrl = `${siteUrl}?invite=${rawToken}`;
            const messageId = await sendInvitationEmail({
                resendKey,
                recipientEmail: existing.email,
                inviterName,
                firstName: existing.first_name,
                inviteUrl,
                expiresAtIso,
            });

            await supabaseAdmin.from('email_logs').insert({
                sender_id: user.id,
                recipient_email: existing.email,
                booking_id: null,
            });

            return jsonResponse({ success: true, invitation: updated, messageId });
        }

        return jsonResponse({ error: 'Unsupported action' }, 400);
    } catch (error) {
        console.error('Unexpected error in invite-user:', error);
        return jsonResponse({ error: 'Internal server error' }, 500);
    }
});
