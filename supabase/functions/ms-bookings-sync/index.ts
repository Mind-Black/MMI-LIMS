import { platformKey } from '../_shared/config.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.86.0';
import {
  buildOutboxRssFeed,
  buildStatusRssFeed,
  constantTimeEqual,
  normalizeInboundPayload,
} from '../_shared/msBookingsSync.js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache, no-store, max-age=0, must-revalidate',
    },
  });
}

function rssResponse(xml: string, status = 200) {
  return new Response(xml, {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, max-age=0, must-revalidate',
    },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  try {
    const url = new URL(req.url);
    const configuredSecret = Deno.env.get('MS_BOOKINGS_SYNC_SECRET') ?? '';
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = platformKey('secret');
    const siteUrl = Deno.env.get('SITE_URL') || 'https://mind-black.github.io/MMI-LIMS/';

    if (!configuredSecret || !supabaseUrl || !supabaseServiceKey) {
      console.error('Server configuration error: missing MS_BOOKINGS_SYNC_SECRET, SUPABASE_URL, or service role key');
      return jsonResponse({ error: 'Server configuration error' }, 500);
    }

    const authHeader = req.headers.get('Authorization') || '';
    const bearerToken = authHeader.toLowerCase().startsWith('bearer ')
      ? authHeader.slice(7).trim()
      : '';
    const querySecret = (url.searchParams.get('secret') || '').trim();
    const providedSecret = bearerToken || querySecret;

    if (!providedSecret || !constantTimeEqual(providedSecret, configuredSecret)) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    let bodyParams: Record<string, unknown> = {};
    if (req.method === 'POST') {
      const rawText = await req.text();
      if (rawText.trim().length > 0) {
        try {
          const parsed = JSON.parse(rawText);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            bodyParams = parsed as Record<string, unknown>;
          } else {
            return jsonResponse({ error: 'JSON body must be an object' }, 400);
          }
        } catch {
          return jsonResponse({ error: 'Invalid JSON request body' }, 400);
        }
      }
    }

    const queryParams = Object.fromEntries(url.searchParams.entries());
    const input: Record<string, unknown> = { ...queryParams, ...bodyParams };
    const action = String(input.action || 'outbox').trim().toLowerCase();
    const formatParam = String(url.searchParams.get('format') || '').trim().toLowerCase();
    const useRss = formatParam === 'rss' || (req.method === 'GET' && formatParam !== 'json');

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    if (action === 'inbound') {
      const normalized = normalizeInboundPayload(input);
      if (!normalized.ms_bookings_email || !normalized.external_id) {
        return jsonResponse(
          { error: 'Missing required fields: ms_bookings_email (or BookingBusinessId) and external_id (or Id)' },
          400,
        );
      }

      const { data, error } = await supabaseAdmin.rpc('sync_inbound_ms_booking', {
        p_ms_bookings_email: normalized.ms_bookings_email,
        p_external_id: normalized.external_id,
        p_event_type: normalized.event_type,
        p_starts_at: normalized.starts_at,
        p_ends_at: normalized.ends_at,
        p_service_id: normalized.service_id,
        p_service_name: normalized.service_name,
        p_staff_id: normalized.staff_id,
        p_staff_email: normalized.staff_email,
        p_customer_email: normalized.customer_email,
        p_customer_name: normalized.customer_name,
        p_notes: normalized.notes,
      });

      if (error) {
        const status = error.code === '23P01' ? 409 : error.code === '22023' ? 400 : 500;
        console.error('Inbound sync error:', error);
        return jsonResponse({ error: error.message || 'Inbound sync failed', code: error.code }, status);
      }

      const result = { status: 'ok', ...(data && typeof data === 'object' ? data : { result: data }) };
      if (useRss) {
        return rssResponse(buildStatusRssFeed('MMI-LIMS Inbound Sync OK', result, siteUrl));
      }
      return jsonResponse(result);
    }

    if (action === 'outbox') {
      const parsedLimit = Number(input.limit ?? 10);
      const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(Math.trunc(parsedLimit), 1), 50) : 10;

      const { data: jobs, error } = await supabaseAdmin.rpc('claim_ms_bookings_outbox', {
        p_limit: limit,
      });

      if (error) {
        console.error('Outbox claim error:', error);
        return jsonResponse({ error: error.message || 'Failed to claim outbox jobs' }, 500);
      }

      if (useRss) {
        return rssResponse(buildOutboxRssFeed(jobs || [], siteUrl));
      }

      const formattedJobs = (jobs || []).map((job: Record<string, unknown>) => ({
        job_id: job.id,
        lease: job.lease,
        action: job.action,
        booking_id: job.booking_id,
        external_id: job.external_id,
        ...(job.payload && typeof job.payload === 'object' ? job.payload : {}),
      }));
      return jsonResponse({ status: 'ok', count: formattedJobs.length, jobs: formattedJobs });
    }

    if (action === 'ack') {
      const jobId = String(input.job_id ?? input.jobId ?? input.id ?? '').trim();
      if (!jobId) {
        return jsonResponse({ error: 'Missing required field: job_id' }, 400);
      }

      const externalIdRaw = input.external_id ?? input.externalId ?? null;
      const errorRaw = input.error ?? null;

      const { data, error } = await supabaseAdmin.rpc('ack_ms_bookings_outbox', {
        p_job_id: jobId,
        p_external_id: externalIdRaw ? String(externalIdRaw).trim() : null,
        p_error: errorRaw ? String(errorRaw) : null,
      });

      if (error) {
        const status = error.code === 'P0002' ? 404 : 500;
        console.error('Outbox ack error:', error);
        return jsonResponse({ error: error.message || 'Failed to acknowledge sync job' }, status);
      }

      const result = { status: 'ok', ...(data && typeof data === 'object' ? data : { result: data }) };
      if (useRss) {
        return rssResponse(buildStatusRssFeed('MMI-LIMS Outbox Ack OK', result, siteUrl));
      }
      return jsonResponse(result);
    }

    return jsonResponse({ error: 'Invalid action. Expected inbound, outbox, or ack.' }, 400);
  } catch (error) {
    console.error('Unexpected error in ms-bookings-sync:', error);
    return jsonResponse({ error: 'Internal Server Error' }, 500);
  }
});
