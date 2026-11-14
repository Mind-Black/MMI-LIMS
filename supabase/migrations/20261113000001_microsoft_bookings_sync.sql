-- ==============================================================================
-- 20261113000001_microsoft_bookings_sync.sql
-- Two-way Microsoft Bookings synchronization via Power Automate (zero admin consent)
-- ==============================================================================

-- 1. Extend public.tools with per-instrument Microsoft Bookings configuration.
-- NOTE: Do not alter RLS policies on public.tools; tools_admin_all and tools_read_all remain authoritative.
ALTER TABLE public.tools
  ADD COLUMN IF NOT EXISTS ms_bookings_email text,
  ADD COLUMN IF NOT EXISTS ms_bookings_service_id text,
  ADD COLUMN IF NOT EXISTS ms_bookings_sync_enabled boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tools_ms_bookings_email_unique
  ON public.tools (lower(trim(ms_bookings_email)))
  WHERE ms_bookings_email IS NOT NULL AND trim(ms_bookings_email) <> '';

-- 2. Service-role isolated staff mapping cache: (tool_id, user_email) -> Microsoft Bookings staffMemberId
CREATE TABLE IF NOT EXISTS public.ms_bookings_staff_mappings (
  tool_id bigint NOT NULL REFERENCES public.tools(id) ON DELETE CASCADE,
  user_email text NOT NULL,
  external_staff_id text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tool_id, user_email)
);

ALTER TABLE public.ms_bookings_staff_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ms_bookings_staff_mappings FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.ms_bookings_staff_mappings FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.ms_bookings_staff_mappings TO service_role;

-- 3. Service-role isolated 1-to-1 booking external identity mapping
CREATE TABLE IF NOT EXISTS public.booking_external_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_id bigint NOT NULL REFERENCES public.tools(id) ON DELETE CASCADE,
  booking_id bigint UNIQUE REFERENCES public.bookings(id) ON DELETE SET NULL,
  external_id text NOT NULL,
  origin text NOT NULL CHECK (origin IN ('ms_bookings', 'lims')),
  service_id text,
  service_name text,
  booker_email text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tool_id, external_id)
);

ALTER TABLE public.booking_external_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_external_mappings FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.booking_external_mappings FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.booking_external_mappings TO service_role;

-- 4. Durable outbound sync outbox for MMI-LIMS -> Microsoft Bookings
CREATE TABLE IF NOT EXISTS public.ms_bookings_sync_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_id bigint NOT NULL REFERENCES public.tools(id) ON DELETE CASCADE,
  booking_id bigint,
  action text NOT NULL CHECK (action IN ('upsert', 'cancel')),
  external_id text,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'synced', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  lease uuid,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  synced_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_ms_bookings_sync_queue_ready
  ON public.ms_bookings_sync_queue(available_at, created_at)
  WHERE status IN ('pending', 'processing');

CREATE INDEX IF NOT EXISTS idx_ms_bookings_sync_queue_booking
  ON public.ms_bookings_sync_queue(booking_id)
  WHERE booking_id IS NOT NULL;

ALTER TABLE public.ms_bookings_sync_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ms_bookings_sync_queue FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.ms_bookings_sync_queue FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.ms_bookings_sync_queue TO service_role;

-- 5. Loop-safe outbound trigger function
CREATE OR REPLACE FUNCTION public.enqueue_ms_bookings_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.bookings;
  v_tool public.tools;
  v_external_id text;
  v_mapped_service_id text;
  v_user_email text;
  v_external_staff_id text;
  v_staff_emails text[] := '{}'::text[];
  v_service_id text;
  v_graph_body jsonb;
  v_bookings_email text;
BEGIN
  -- Suppress infinite echo when inbound sync writes to public.bookings
  IF current_setting('mmi.sync_source', true) = 'ms_bookings' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  v_row := COALESCE(NEW, OLD);

  SELECT * INTO v_tool FROM public.tools WHERE id = v_row.tool_id;
  IF NOT FOUND
     OR NOT v_tool.ms_bookings_sync_enabled
     OR v_tool.ms_bookings_email IS NULL
     OR trim(v_tool.ms_bookings_email) = '' THEN
    RETURN v_row;
  END IF;

  v_bookings_email := trim(v_tool.ms_bookings_email);

  SELECT external_id, service_id
  INTO v_external_id, v_mapped_service_id
  FROM public.booking_external_mappings
  WHERE booking_id = v_row.id;

  IF v_external_id IS NULL THEN
    SELECT external_id INTO v_external_id
    FROM public.ms_bookings_sync_queue
    WHERE booking_id = v_row.id
      AND external_id IS NOT NULL
      AND status = 'synced'
    ORDER BY synced_at DESC NULLS LAST, created_at DESC
    LIMIT 1;
  END IF;

  SELECT lower(trim(COALESCE(NULLIF(p.email, ''), u.email)))
  INTO v_user_email
  FROM public.profiles p
  LEFT JOIN auth.users u ON u.id = p.id
  WHERE p.id = v_row.user_id;

  IF v_user_email IS NOT NULL AND v_user_email <> '' THEN
    SELECT external_staff_id
    INTO v_external_staff_id
    FROM public.ms_bookings_staff_mappings
    WHERE tool_id = v_tool.id AND user_email = v_user_email;
  END IF;

  SELECT COALESCE(
    array_agg(DISTINCT lower(trim(COALESCE(NULLIF(p.email, ''), u.email))))
    FILTER (WHERE NULLIF(trim(COALESCE(NULLIF(p.email, ''), u.email)), '') IS NOT NULL),
    '{}'::text[]
  )
  INTO v_staff_emails
  FROM public.profiles p
  LEFT JOIN auth.users u ON u.id = p.id
  WHERE p.is_approved = true
    AND (
      p.licenses ? v_tool.id::text
      OR p.id = v_tool.primary_responsible_id
      OR p.id = v_tool.secondary_responsible_id
    );

  -- Cancel path: row deleted, or transitioned to rejected/cancelled
  IF TG_OP = 'DELETE' OR NEW.status IN ('rejected', 'cancelled') THEN
    DELETE FROM public.ms_bookings_sync_queue
    WHERE booking_id = v_row.id AND status = 'pending';

    IF v_external_id IS NOT NULL AND trim(v_external_id) <> '' THEN
      INSERT INTO public.ms_bookings_sync_queue (tool_id, booking_id, action, external_id, payload)
      VALUES (
        v_row.tool_id,
        v_row.id,
        'cancel',
        v_external_id,
        jsonb_build_object(
          'action', 'cancel',
          'booking_id', v_row.id,
          'tool_id', v_row.tool_id,
          'tool_name', v_row.tool_name,
          'ms_bookings_email', v_bookings_email,
          'external_id', v_external_id,
          'starts_at', v_row.starts_at,
          'ends_at', v_row.ends_at,
          'date', v_row.date::text,
          'time', v_row.time::text,
          'end_time', v_row.end_time::text,
          'user_name', v_row.user_name,
          'user_email', COALESCE(v_user_email, ''),
          'project', v_row.project,
          'staff_emails', to_jsonb(v_staff_emails),
          'subject', '[MMI-LIMS #' || v_row.id || '] Cancelled: ' || v_row.tool_name || ' - ' || v_row.user_name,
          'graph_method', 'POST',
          'graph_endpoint', '/v1.0/solutions/bookingBusinesses/' || v_bookings_email || '/appointments/' || v_external_id || '/cancel',
          'graph_body', jsonb_build_object(
            'cancellationMessage', '[MMI-LIMS #' || v_row.id || '] Cancelled in MMI-LIMS'
          )
        )
      );
    END IF;

    RETURN v_row;
  END IF;

  -- Upsert path (INSERT or active UPDATE)
  DELETE FROM public.ms_bookings_sync_queue
  WHERE booking_id = NEW.id AND status = 'pending';

  v_service_id := COALESCE(
    NULLIF(trim(v_mapped_service_id), ''),
    NULLIF(trim(v_tool.ms_bookings_service_id), ''),
    ''
  );

  v_graph_body := jsonb_build_object(
    '@odata.type', '#microsoft.graph.bookingAppointment',
    'serviceId', v_service_id,
    'startDateTime', jsonb_build_object(
      '@odata.type', '#microsoft.graph.dateTimeTimeZone',
      'dateTime', to_char(NEW.starts_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS".0000000"'),
      'timeZone', 'UTC'
    ),
    'endDateTime', jsonb_build_object(
      '@odata.type', '#microsoft.graph.dateTimeTimeZone',
      'dateTime', to_char(NEW.ends_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS".0000000"'),
      'timeZone', 'UTC'
    ),
    'staffMemberIds', CASE
      WHEN v_external_staff_id IS NOT NULL THEN jsonb_build_array(v_external_staff_id)
      ELSE '[]'::jsonb
    END,
    'customers', jsonb_build_array(
      jsonb_build_object(
        '@odata.type', '#microsoft.graph.bookingCustomerInformation',
        'name', NEW.user_name,
        'emailAddress', COALESCE(v_user_email, ''),
        'notes', '[MMI-LIMS #' || NEW.id || '] Project: ' || COALESCE(NEW.project, 'General')
      )
    ),
    'serviceNotes', '[MMI-LIMS #' || NEW.id || '] Synced from MMI-LIMS (' || NEW.tool_name || ' - ' || COALESCE(NEW.project, 'General') || ')'
  );

  INSERT INTO public.ms_bookings_sync_queue (tool_id, booking_id, action, external_id, payload)
  VALUES (
    NEW.tool_id,
    NEW.id,
    'upsert',
    v_external_id,
    jsonb_build_object(
      'action', 'upsert',
      'booking_id', NEW.id,
      'tool_id', NEW.tool_id,
      'tool_name', NEW.tool_name,
      'ms_bookings_email', v_bookings_email,
      'service_id', v_service_id,
      'external_id', v_external_id,
      'starts_at', NEW.starts_at,
      'ends_at', NEW.ends_at,
      'date', NEW.date::text,
      'time', NEW.time::text,
      'end_time', NEW.end_time::text,
      'user_name', NEW.user_name,
      'user_email', COALESCE(v_user_email, ''),
      'project', NEW.project,
      'status', NEW.status,
      'staff_emails', to_jsonb(v_staff_emails),
      'subject', '[MMI-LIMS #' || NEW.id || '] ' || NEW.tool_name || ' - ' || NEW.user_name,
      'graph_method', CASE WHEN v_external_id IS NOT NULL THEN 'PATCH' ELSE 'POST' END,
      'graph_endpoint', '/v1.0/solutions/bookingBusinesses/' || v_bookings_email || '/appointments' || CASE WHEN v_external_id IS NOT NULL THEN '/' || v_external_id ELSE '' END,
      'graph_body', v_graph_body
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_enqueue_ms_bookings_sync ON public.bookings;
CREATE TRIGGER tr_enqueue_ms_bookings_sync
  AFTER INSERT OR UPDATE ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.enqueue_ms_bookings_sync();

-- BEFORE DELETE runs after tr_enforce_booking_delete_rules (alphabetical) and before ON DELETE SET NULL clears mapping.booking_id
DROP TRIGGER IF EXISTS z_enqueue_ms_bookings_sync_delete ON public.bookings;
CREATE TRIGGER z_enqueue_ms_bookings_sync_delete
  BEFORE DELETE ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.enqueue_ms_bookings_sync();

-- 6. Service-role RPC: Inbound Microsoft Bookings -> MMI-LIMS
CREATE OR REPLACE FUNCTION public.sync_inbound_ms_booking(
  p_ms_bookings_email text,
  p_external_id text,
  p_event_type text,
  p_starts_at timestamptz DEFAULT NULL,
  p_ends_at timestamptz DEFAULT NULL,
  p_service_id text DEFAULT NULL,
  p_service_name text DEFAULT NULL,
  p_staff_id text DEFAULT NULL,
  p_staff_email text DEFAULT NULL,
  p_customer_email text DEFAULT NULL,
  p_customer_name text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_type text := lower(trim(COALESCE(p_event_type, '')));
  v_ext_id text := NULLIF(trim(COALESCE(p_external_id, '')), '');
  v_tool public.tools;
  v_existing_map public.booking_external_mappings;
  v_echo_match text[];
  v_echo_booking_id bigint;
  v_local_date date;
  v_local_start time;
  v_local_end time;
  v_user_id uuid;
  v_project text;
  v_booking_id bigint;
BEGIN
  IF NULLIF(trim(COALESCE(p_ms_bookings_email, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Microsoft Bookings email is required' USING ERRCODE = '22023';
  END IF;

  IF v_ext_id IS NULL THEN
    RAISE EXCEPTION 'External appointment ID is required' USING ERRCODE = '22023';
  END IF;

  IF v_event_type NOT IN ('created', 'updated', 'cancelled') THEN
    RAISE EXCEPTION 'Invalid event type: %', p_event_type USING ERRCODE = '22023';
  END IF;

  -- Mark transaction as originating from MS Bookings to suppress outbound echo
  PERFORM set_config('mmi.sync_source', 'ms_bookings', true);

  SELECT * INTO v_tool
  FROM public.tools
  WHERE lower(trim(ms_bookings_email)) = lower(trim(p_ms_bookings_email))
    AND ms_bookings_sync_enabled = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown or sync-disabled Microsoft Bookings address' USING ERRCODE = '22023';
  END IF;

  -- Auto-learn default serviceId for this tool on first inbound event
  IF NULLIF(trim(COALESCE(p_service_id, '')), '') IS NOT NULL
     AND NULLIF(trim(COALESCE(v_tool.ms_bookings_service_id, '')), '') IS NULL THEN
    UPDATE public.tools
    SET ms_bookings_service_id = trim(p_service_id)
    WHERE id = v_tool.id;
  END IF;

  -- Auto-learn staff member GUID mapping for this tool
  IF NULLIF(trim(COALESCE(p_staff_id, '')), '') IS NOT NULL
     AND NULLIF(trim(COALESCE(p_staff_email, '')), '') IS NOT NULL THEN
    INSERT INTO public.ms_bookings_staff_mappings (tool_id, user_email, external_staff_id, updated_at)
    VALUES (v_tool.id, lower(trim(p_staff_email)), trim(p_staff_id), now())
    ON CONFLICT (tool_id, user_email) DO UPDATE
      SET external_staff_id = EXCLUDED.external_staff_id,
          updated_at = now();
  END IF;

  -- Echo check 1: payload notes carry [MMI-LIMS #<id>] marker
  v_echo_match := regexp_match(COALESCE(p_notes, ''), '\[MMI-LIMS #([0-9]+)\]');
  IF v_echo_match IS NOT NULL THEN
    v_echo_booking_id := v_echo_match[1]::bigint;
    IF EXISTS (SELECT 1 FROM public.bookings WHERE id = v_echo_booking_id AND tool_id = v_tool.id) THEN
      DELETE FROM public.booking_external_mappings
      WHERE (booking_id = v_echo_booking_id AND external_id <> v_ext_id)
         OR (tool_id = v_tool.id AND external_id = v_ext_id AND booking_id IS DISTINCT FROM v_echo_booking_id);

      INSERT INTO public.booking_external_mappings (
        tool_id, booking_id, external_id, origin, service_id, service_name, booker_email, updated_at
      )
      VALUES (
        v_tool.id,
        v_echo_booking_id,
        v_ext_id,
        'lims',
        NULLIF(trim(COALESCE(p_service_id, '')), ''),
        NULLIF(trim(COALESCE(p_service_name, '')), ''),
        COALESCE(NULLIF(trim(COALESCE(p_staff_email, '')), ''), NULLIF(trim(COALESCE(p_customer_email, '')), '')),
        now()
      )
      ON CONFLICT (tool_id, external_id) DO UPDATE
        SET booking_id = EXCLUDED.booking_id,
            origin = 'lims',
            service_id = COALESCE(EXCLUDED.service_id, public.booking_external_mappings.service_id),
            service_name = COALESCE(EXCLUDED.service_name, public.booking_external_mappings.service_name),
            updated_at = now();
    END IF;

    IF v_event_type <> 'cancelled' THEN
      RETURN jsonb_build_object('status', 'ignored_echo', 'booking_id', v_echo_booking_id);
    END IF;
  END IF;

  SELECT * INTO v_existing_map
  FROM public.booking_external_mappings
  WHERE tool_id = v_tool.id AND external_id = v_ext_id;

  -- Echo check 2: already mapped as originating in LIMS and trigger fired 'created'
  IF FOUND AND v_existing_map.origin = 'lims' AND v_event_type = 'created' THEN
    RETURN jsonb_build_object('status', 'ignored_echo', 'booking_id', v_existing_map.booking_id);
  END IF;

  -- Handle cancellation
  IF v_event_type = 'cancelled' THEN
    IF v_existing_map.id IS NOT NULL THEN
      IF v_existing_map.booking_id IS NOT NULL THEN
        DELETE FROM public.bookings WHERE id = v_existing_map.booking_id;
      END IF;
      DELETE FROM public.booking_external_mappings WHERE id = v_existing_map.id;
    ELSIF v_echo_booking_id IS NOT NULL THEN
      DELETE FROM public.bookings WHERE id = v_echo_booking_id AND tool_id = v_tool.id;
    END IF;

    RETURN jsonb_build_object(
      'status', 'cancelled',
      'booking_id', COALESCE(v_existing_map.booking_id, v_echo_booking_id)
    );
  END IF;

  -- Handle created / updated
  IF p_starts_at IS NULL OR p_ends_at IS NULL OR p_ends_at <= p_starts_at THEN
    RAISE EXCEPTION 'Valid starts_at and ends_at (ends_at > starts_at) are required' USING ERRCODE = '22023';
  END IF;

  IF (p_ends_at - p_starts_at) < interval '1 minute' OR (p_ends_at - p_starts_at) > interval '24 hours' THEN
    RAISE EXCEPTION 'Booking duration must be between 1 minute and 24 hours' USING ERRCODE = '22023';
  END IF;

  v_local_date := (p_starts_at AT TIME ZONE 'Europe/Vilnius')::date;
  v_local_start := date_trunc('minute', p_starts_at AT TIME ZONE 'Europe/Vilnius')::time;
  v_local_end := date_trunc('minute', p_ends_at AT TIME ZONE 'Europe/Vilnius')::time;

  -- Resolve booking owner (prefer staff_email, then customer_email, then tool responsibles, then admin)
  IF NULLIF(trim(COALESCE(p_staff_email, '')), '') IS NOT NULL THEN
    SELECT p.id INTO v_user_id
    FROM public.profiles p
    LEFT JOIN auth.users u ON u.id = p.id
    WHERE p.is_approved = true
      AND lower(trim(COALESCE(NULLIF(p.email, ''), u.email))) = lower(trim(p_staff_email))
    ORDER BY p.updated_at ASC
    LIMIT 1;
  END IF;

  IF v_user_id IS NULL AND NULLIF(trim(COALESCE(p_customer_email, '')), '') IS NOT NULL THEN
    SELECT p.id INTO v_user_id
    FROM public.profiles p
    LEFT JOIN auth.users u ON u.id = p.id
    WHERE p.is_approved = true
      AND lower(trim(COALESCE(NULLIF(p.email, ''), u.email))) = lower(trim(p_customer_email))
    ORDER BY p.updated_at ASC
    LIMIT 1;
  END IF;

  IF v_user_id IS NULL AND v_tool.primary_responsible_id IS NOT NULL THEN
    SELECT id INTO v_user_id FROM public.profiles WHERE id = v_tool.primary_responsible_id AND is_approved = true;
  END IF;

  IF v_user_id IS NULL AND v_tool.secondary_responsible_id IS NOT NULL THEN
    SELECT id INTO v_user_id FROM public.profiles WHERE id = v_tool.secondary_responsible_id AND is_approved = true;
  END IF;

  IF v_user_id IS NULL THEN
    SELECT id INTO v_user_id
    FROM public.profiles
    WHERE access_level = 'admin' AND is_approved = true
    ORDER BY updated_at ASC
    LIMIT 1;
  END IF;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No approved user profile available to assign inbound booking' USING ERRCODE = '22023';
  END IF;

  v_project := 'MS Bookings'
    || CASE
         WHEN NULLIF(trim(COALESCE(p_service_name, '')), '') IS NOT NULL
           THEN ': ' || left(trim(p_service_name), 40)
         ELSE ''
       END
    || CASE
         WHEN NULLIF(trim(COALESCE(p_customer_name, '')), '') IS NOT NULL
           THEN ' (' || left(trim(p_customer_name), 40) || ')'
         ELSE ''
       END;

  IF v_existing_map.booking_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.bookings WHERE id = v_existing_map.booking_id) THEN
    UPDATE public.bookings
    SET
      date = v_local_date,
      time = v_local_start,
      end_time = v_local_end,
      project = v_project,
      status = 'confirmed'
    WHERE id = v_existing_map.booking_id
    RETURNING id INTO v_booking_id;
  ELSE
    INSERT INTO public.bookings (
      tool_id, user_id, tool_name, user_name, project, date, time, end_time, status
    )
    VALUES (
      v_tool.id, v_user_id, '', '', v_project, v_local_date, v_local_start, v_local_end, 'confirmed'
    )
    RETURNING id INTO v_booking_id;
  END IF;

  DELETE FROM public.booking_external_mappings
  WHERE booking_id = v_booking_id AND external_id <> v_ext_id;

  INSERT INTO public.booking_external_mappings (
    tool_id, booking_id, external_id, origin, service_id, service_name, booker_email, updated_at
  )
  VALUES (
    v_tool.id,
    v_booking_id,
    v_ext_id,
    COALESCE(v_existing_map.origin, 'ms_bookings'),
    NULLIF(trim(COALESCE(p_service_id, '')), ''),
    NULLIF(trim(COALESCE(p_service_name, '')), ''),
    COALESCE(NULLIF(trim(COALESCE(p_staff_email, '')), ''), NULLIF(trim(COALESCE(p_customer_email, '')), '')),
    now()
  )
  ON CONFLICT (tool_id, external_id) DO UPDATE
    SET booking_id = EXCLUDED.booking_id,
        service_id = COALESCE(EXCLUDED.service_id, public.booking_external_mappings.service_id),
        service_name = COALESCE(EXCLUDED.service_name, public.booking_external_mappings.service_name),
        booker_email = COALESCE(EXCLUDED.booker_email, public.booking_external_mappings.booker_email),
        updated_at = now();

  RETURN jsonb_build_object(
    'status', 'synced',
    'booking_id', v_booking_id,
    'tool_id', v_tool.id,
    'user_id', v_user_id
  );
END;
$$;

-- 7. Service-role RPC: Claim pending outbound sync jobs
CREATE OR REPLACE FUNCTION public.claim_ms_bookings_outbox(p_limit integer DEFAULT 10)
RETURNS SETOF public.ms_bookings_sync_queue
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.ms_bookings_sync_queue
  SET
    status = 'processing',
    lease = gen_random_uuid(),
    attempts = attempts + 1,
    available_at = now() + interval '5 minutes'
  WHERE id IN (
    SELECT id
    FROM public.ms_bookings_sync_queue
    WHERE status IN ('pending', 'processing')
      AND available_at <= now()
    ORDER BY available_at, created_at, id
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 10), 1), 50)
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
$$;

-- 8. Service-role RPC: Acknowledge outbound sync job completion or failure
CREATE OR REPLACE FUNCTION public.ack_ms_bookings_outbox(
  p_job_id uuid,
  p_external_id text DEFAULT NULL,
  p_error text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.ms_bookings_sync_queue;
  v_ext_id text;
  v_tool public.tools;
BEGIN
  SELECT * INTO v_job FROM public.ms_bookings_sync_queue WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sync job not found' USING ERRCODE = 'P0002';
  END IF;

  v_ext_id := COALESCE(NULLIF(trim(COALESCE(p_external_id, '')), ''), NULLIF(trim(COALESCE(v_job.external_id, '')), ''));

  IF p_error IS NULL OR trim(p_error) = '' THEN
    UPDATE public.ms_bookings_sync_queue
    SET
      status = 'synced',
      synced_at = now(),
      external_id = v_ext_id,
      lease = NULL,
      last_error = NULL
    WHERE id = p_job_id
    RETURNING * INTO v_job;

    IF v_job.action = 'upsert' AND v_job.booking_id IS NOT NULL AND v_ext_id IS NOT NULL THEN
      IF EXISTS (SELECT 1 FROM public.bookings WHERE id = v_job.booking_id) THEN
        DELETE FROM public.booking_external_mappings
        WHERE (booking_id = v_job.booking_id AND external_id <> v_ext_id)
           OR (tool_id = v_job.tool_id AND external_id = v_ext_id AND booking_id IS DISTINCT FROM v_job.booking_id);

        INSERT INTO public.booking_external_mappings (tool_id, booking_id, external_id, origin, updated_at)
        VALUES (v_job.tool_id, v_job.booking_id, v_ext_id, 'lims', now())
        ON CONFLICT (tool_id, external_id) DO UPDATE
          SET booking_id = EXCLUDED.booking_id,
              origin = 'lims',
              updated_at = now();
      ELSE
        -- Booking was deleted in LIMS while upsert was in flight; enqueue cancellation for the newly created MS event
        SELECT * INTO v_tool FROM public.tools WHERE id = v_job.tool_id;
        IF FOUND AND v_tool.ms_bookings_email IS NOT NULL AND trim(v_tool.ms_bookings_email) <> '' THEN
          INSERT INTO public.ms_bookings_sync_queue (tool_id, booking_id, action, external_id, payload)
          VALUES (
            v_job.tool_id,
            v_job.booking_id,
            'cancel',
            v_ext_id,
            jsonb_build_object(
              'action', 'cancel',
              'booking_id', v_job.booking_id,
              'tool_id', v_job.tool_id,
              'ms_bookings_email', trim(v_tool.ms_bookings_email),
              'external_id', v_ext_id,
              'subject', '[MMI-LIMS #' || v_job.booking_id || '] Cancelled in MMI-LIMS',
              'graph_method', 'POST',
              'graph_endpoint', '/v1.0/solutions/bookingBusinesses/' || trim(v_tool.ms_bookings_email) || '/appointments/' || v_ext_id || '/cancel',
              'graph_body', jsonb_build_object(
                'cancellationMessage', '[MMI-LIMS #' || v_job.booking_id || '] Cancelled in MMI-LIMS'
              )
            )
          );
        END IF;
      END IF;
    ELSIF v_job.action = 'cancel' THEN
      DELETE FROM public.booking_external_mappings
      WHERE (v_job.booking_id IS NOT NULL AND booking_id = v_job.booking_id)
         OR (v_ext_id IS NOT NULL AND tool_id = v_job.tool_id AND external_id = v_ext_id);
    END IF;
  ELSE
    UPDATE public.ms_bookings_sync_queue
    SET
      status = CASE WHEN attempts >= 8 THEN 'failed' ELSE 'pending' END,
      last_error = left(p_error, 500),
      available_at = now() + interval '1 minute' * power(2, LEAST(attempts, 8)),
      lease = NULL
    WHERE id = p_job_id
    RETURNING * INTO v_job;
  END IF;

  RETURN jsonb_build_object(
    'status', v_job.status,
    'job_id', v_job.id,
    'external_id', v_job.external_id
  );
END;
$$;

-- 9. Lock down function execution strictly to service_role
REVOKE ALL ON FUNCTION
  public.enqueue_ms_bookings_sync(),
  public.sync_inbound_ms_booking(text, text, text, timestamptz, timestamptz, text, text, text, text, text, text, text),
  public.claim_ms_bookings_outbox(integer),
  public.ack_ms_bookings_outbox(uuid, text, text)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.sync_inbound_ms_booking(text, text, text, timestamptz, timestamptz, text, text, text, text, text, text, text),
  public.claim_ms_bookings_outbox(integer),
  public.ack_ms_bookings_outbox(uuid, text, text)
TO service_role;

NOTIFY pgrst, 'reload schema';
