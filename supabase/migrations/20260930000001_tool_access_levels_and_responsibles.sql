-- ==============================================================================
-- 20260930000001_tool_access_levels_and_responsibles.sql
-- 3-Tier Tool Access Levels (Level I, II, III), Tool Responsibles,
-- Tentative Booking Holds, and Training Applications
-- ==============================================================================

-- 0. Temporarily disable user triggers on profiles to prevent legacy triggers from blocking migration
ALTER TABLE public.profiles DISABLE TRIGGER USER;

-- Safely remove any legacy triggers calling check_profile_update()
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN (
    SELECT t.tgname
    FROM pg_trigger t
    JOIN pg_proc p ON t.tgfoid = p.oid
    WHERE t.tgrelid = 'public.profiles'::regclass
      AND p.proname = 'check_profile_update'
  ) LOOP
    EXECUTE 'DROP TRIGGER IF EXISTS ' || quote_ident(r.tgname) || ' ON public.profiles CASCADE;';
  END LOOP;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- Drop legacy check_profile_update function if it exists
DO $$
DECLARE
  func_rec RECORD;
BEGIN
  FOR func_rec IN (
    SELECT p.oid::regprocedure AS proc_name
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE p.proname = 'check_profile_update'
      AND n.nspname = 'public'
  ) LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || func_rec.proc_name || ' CASCADE;';
  END LOOP;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- 1. Upgrade public.profiles with contact details if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'email'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN email text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'phone'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN phone text;
  END IF;
END $$;

-- Backfill profile emails from auth.users where possible
DO $$
BEGIN
  UPDATE public.profiles p
  SET email = u.email
  FROM auth.users u
  WHERE p.id = u.id AND (p.email IS NULL OR p.email = '');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- 2. Migrate profiles.licenses from array format to JSON object format
-- Legacy: ["1", "2"] -> Refined: {"1": "level_3", "2": "level_3"}
UPDATE public.profiles
SET licenses = (
  SELECT COALESCE(jsonb_object_agg(elem, 'level_3'), '{}'::jsonb)
  FROM jsonb_array_elements_text(licenses) elem
)
WHERE jsonb_typeof(licenses) = 'array';

ALTER TABLE public.profiles ALTER COLUMN licenses SET DEFAULT '{}'::jsonb;

-- Ensure secure profile update validation trigger exists and allows admin & migration changes
CREATE OR REPLACE FUNCTION public.enforce_profile_update_rules()
RETURNS trigger AS $$
BEGIN
  IF auth.uid() IS NULL OR CURRENT_USER = 'postgres' OR public.is_admin(auth.uid()) THEN
    NEW.updated_at := timezone('utc'::text, now());
    RETURN NEW;
  END IF;

  -- Non-admin self-service edit rules
  IF NEW.access_level IS DISTINCT FROM OLD.access_level THEN
    RAISE EXCEPTION 'Unauthorized: cannot modify access_level' USING ERRCODE = '42501';
  END IF;
  IF NEW.is_approved IS DISTINCT FROM OLD.is_approved THEN
    RAISE EXCEPTION 'Unauthorized: cannot modify is_approved' USING ERRCODE = '42501';
  END IF;
  IF NEW.licenses IS DISTINCT FROM OLD.licenses THEN
    RAISE EXCEPTION 'Unauthorized: cannot modify licenses' USING ERRCODE = '42501';
  END IF;
  IF NEW.projects IS DISTINCT FROM OLD.projects THEN
    RAISE EXCEPTION 'Unauthorized: cannot modify projects' USING ERRCODE = '42501';
  END IF;

  NEW.updated_at := timezone('utc'::text, now());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS tr_enforce_profile_update_rules ON public.profiles;
CREATE TRIGGER tr_enforce_profile_update_rules
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_profile_update_rules();

-- Re-enable user triggers on profiles
ALTER TABLE public.profiles ENABLE TRIGGER USER;

-- 3. Upgrade public.tools with Tool Responsibles
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'tools' AND column_name = 'primary_responsible_id'
  ) THEN
    ALTER TABLE public.tools ADD COLUMN primary_responsible_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'tools' AND column_name = 'secondary_responsible_id'
  ) THEN
    ALTER TABLE public.tools ADD COLUMN secondary_responsible_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tools_primary_responsible ON public.tools(primary_responsible_id);
CREATE INDEX IF NOT EXISTS idx_tools_secondary_responsible ON public.tools(secondary_responsible_id);

-- Assign default Tool Responsible: Admin user for all existing tools
DO $$
DECLARE
  v_admin_id uuid;
BEGIN
  SELECT id INTO v_admin_id FROM public.profiles WHERE access_level = 'admin' ORDER BY id LIMIT 1;
  IF v_admin_id IS NOT NULL THEN
    UPDATE public.tools
    SET primary_responsible_id = v_admin_id
    WHERE primary_responsible_id IS NULL;
  END IF;
END $$;

-- 4. Upgrade public.bookings with status, confirmation metadata
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'bookings' AND column_name = 'status'
  ) THEN
    ALTER TABLE public.bookings ADD COLUMN status text NOT NULL DEFAULT 'confirmed';
    ALTER TABLE public.bookings ADD CONSTRAINT booking_status_check CHECK (status IN ('confirmed', 'pending_approval', 'rejected', 'cancelled'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'bookings' AND column_name = 'confirmed_by'
  ) THEN
    ALTER TABLE public.bookings ADD COLUMN confirmed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'bookings' AND column_name = 'confirmed_at'
  ) THEN
    ALTER TABLE public.bookings ADD COLUMN confirmed_at timestamptz;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_bookings_tool_status_date ON public.bookings(tool_id, status, date);

-- Update exclusion constraint so both 'confirmed' and 'pending_approval' (Level II) hold the slot tentatively
ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS no_overlapping_active_bookings;
ALTER TABLE public.bookings ADD CONSTRAINT no_overlapping_active_bookings EXCLUDE USING gist (
  tool_id WITH =,
  tstzrange(starts_at, ends_at, '[)') WITH &&
) WHERE (status IN ('confirmed', 'pending_approval'));

-- 5. Create Training Requests Table
CREATE TABLE IF NOT EXISTS public.training_requests (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  tool_id bigint NOT NULL REFERENCES public.tools(id) ON DELETE CASCADE,
  tool_name text NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_name text NOT NULL,
  user_email text,
  description text NOT NULL,
  preferred_date date NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_training_requests_tool_status ON public.training_requests(tool_id, status);
CREATE INDEX IF NOT EXISTS idx_training_requests_user ON public.training_requests(user_id);

-- 6. Helper Functions
-- Resolve tool access level from licenses jsonb
CREATE OR REPLACE FUNCTION public.get_tool_access_level(p_licenses jsonb, p_tool_id bigint)
RETURNS text AS $$
DECLARE
  v_val text;
BEGIN
  IF p_licenses IS NULL THEN
    RETURN 'none';
  END IF;

  -- Support legacy JSON array (e.g. ["1", "2"] -> Level III)
  IF jsonb_typeof(p_licenses) = 'array' THEN
    IF p_licenses ? p_tool_id::text OR p_licenses @> to_jsonb(p_tool_id) OR p_licenses @> to_jsonb(p_tool_id::text) THEN
      RETURN 'level_3';
    ELSE
      RETURN 'none';
    END IF;
  END IF;

  -- JSON Object map (e.g. {"1": "level_2", "1": "level_3"})
  IF jsonb_typeof(p_licenses) = 'object' THEN
    v_val := lower(trim(COALESCE(p_licenses->>p_tool_id::text, '')));
    IF v_val IN ('level_1', 'level_2', 'level_3') THEN
      RETURN v_val;
    END IF;
  END IF;

  RETURN 'none';
END;
$$ LANGUAGE plpgsql IMMUTABLE;

REVOKE EXECUTE ON FUNCTION public.get_tool_access_level(jsonb, bigint) FROM public;
GRANT EXECUTE ON FUNCTION public.get_tool_access_level(jsonb, bigint) TO authenticated;

-- Check if a user is a designated Tool Responsible for a tool
CREATE OR REPLACE FUNCTION public.is_tool_responsible(p_user_id uuid, p_tool_id bigint)
RETURNS boolean AS $$
BEGIN
  IF p_user_id IS NULL THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.tools
    WHERE id = p_tool_id
      AND (primary_responsible_id = p_user_id OR secondary_responsible_id = p_user_id)
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.is_tool_responsible(uuid, bigint) FROM public;
GRANT EXECUTE ON FUNCTION public.is_tool_responsible(uuid, bigint) TO authenticated;

-- 6.5 Clean up legacy validate_and_set_booking_range triggers from baseline schema
DROP TRIGGER IF EXISTS trg_validate_and_set_booking_range ON public.bookings;
DROP TRIGGER IF EXISTS tr_validate_and_set_booking_range ON public.bookings;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN (
    SELECT t.tgname
    FROM pg_trigger t
    JOIN pg_proc p ON t.tgfoid = p.oid
    WHERE t.tgrelid = 'public.bookings'::regclass
      AND p.proname = 'validate_and_set_booking_range'
  ) LOOP
    EXECUTE 'DROP TRIGGER IF EXISTS ' || quote_ident(r.tgname) || ' ON public.bookings CASCADE;';
  END LOOP;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- Neutralize validate_and_set_booking_range if anything still references it
CREATE OR REPLACE FUNCTION public.validate_and_set_booking_range()
RETURNS trigger AS $$
BEGIN
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 7. Update Booking Enforcement Trigger for Level I, II, III
CREATE OR REPLACE FUNCTION public.enforce_booking_rules()
RETURNS trigger AS $$
DECLARE
  v_caller_id uuid;
  v_is_admin boolean;
  v_is_responsible boolean;
  v_tool record;
  v_profile record;
  v_user_level text;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    -- Direct database migrations / system processes
    RETURN NEW;
  END IF;

  v_is_admin := public.is_admin(v_caller_id);
  v_is_responsible := public.is_tool_responsible(v_caller_id, NEW.tool_id);

  -- 1. Owner check on insert/normal update
  IF NOT v_is_admin AND NOT v_is_responsible AND NEW.user_id <> v_caller_id THEN
    RAISE EXCEPTION 'Unauthorized: user_id must match authenticated user' USING ERRCODE = '42501';
  END IF;

  -- 2. Fetch tool
  SELECT * INTO v_tool FROM public.tools WHERE id = NEW.tool_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tool not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_tool.status <> 'up' AND NOT v_is_admin THEN
    RAISE EXCEPTION 'Tool is not available' USING ERRCODE = '22023';
  END IF;

  -- 3. Fetch profile
  SELECT * INTO v_profile FROM public.profiles WHERE id = NEW.user_id;
  IF NOT FOUND OR NOT v_profile.is_approved THEN
    RAISE EXCEPTION 'User profile not found or not approved' USING ERRCODE = '42501';
  END IF;

  -- Compute canonical timestamps & metadata (Europe/Vilnius)
  IF NEW.end_time IS NULL THEN
    NEW.end_time := (NEW.time + interval '30 minutes')::time;
  END IF;

  IF NEW.end_time <= NEW.time THEN
    RAISE EXCEPTION 'end_time (%) must be after time (%)', NEW.end_time, NEW.time;
  END IF;

  IF NEW.starts_at IS NULL THEN
    NEW.starts_at := (NEW.date::text || ' ' || NEW.time::text)::timestamp AT TIME ZONE 'Europe/Vilnius';
  END IF;
  IF NEW.ends_at IS NULL THEN
    NEW.ends_at := (NEW.date::text || ' ' || NEW.end_time::text)::timestamp AT TIME ZONE 'Europe/Vilnius';
  END IF;

  IF NEW.tool_name IS NULL OR NEW.tool_name = '' THEN
    NEW.tool_name := v_tool.name;
  END IF;

  IF NEW.user_name IS NULL OR NEW.user_name = '' THEN
    NEW.user_name := TRIM(COALESCE(v_profile.first_name, '') || ' ' || COALESCE(v_profile.last_name, ''));
    IF NEW.user_name = '' THEN
      NEW.user_name := 'User ' || SUBSTRING(NEW.user_id::text, 1, 8);
    END IF;
  END IF;

  -- 4. Access Level & License Verification
  IF v_tool.license_req AND NOT v_is_admin THEN
    v_user_level := public.get_tool_access_level(v_profile.licenses, NEW.tool_id);

    IF v_user_level = 'none' THEN
      RAISE EXCEPTION 'User lacks required license for this tool' USING ERRCODE = '42501';
    ELSIF v_user_level = 'level_1' THEN
      RAISE EXCEPTION 'Level I users are undergoing training and cannot book' USING ERRCODE = '42501';
    ELSIF v_user_level = 'level_2' THEN
      -- Level II bookings require confirmation. Enforce pending_approval on insert.
      IF TG_OP = 'INSERT' THEN
        NEW.status := 'pending_approval';
        NEW.confirmed_by := NULL;
        NEW.confirmed_at := NULL;
      ELSIF TG_OP = 'UPDATE' AND NOT v_is_responsible AND NOT v_is_admin THEN
        -- If an ordinary user updates time/date of their booking, reset to pending_approval
        IF (NEW.date IS DISTINCT FROM OLD.date) OR (NEW.time IS DISTINCT FROM OLD.time) OR (NEW.end_time IS DISTINCT FROM OLD.end_time) THEN
          NEW.status := 'pending_approval';
          NEW.confirmed_by := NULL;
          NEW.confirmed_at := NULL;
        END IF;
      END IF;
    ELSIF v_user_level = 'level_3' THEN
      -- Level III: independent booking
      IF TG_OP = 'INSERT' AND (NEW.status IS NULL OR NEW.status = '') THEN
        NEW.status := 'confirmed';
      END IF;
    END IF;
  ELSE
    -- Tool doesn't require a license, or admin is booking
    IF TG_OP = 'INSERT' AND (NEW.status IS NULL OR NEW.status = '') THEN
      NEW.status := 'confirmed';
    END IF;
  END IF;

  -- 5. Project check
  IF NOT v_is_admin AND array_length(v_profile.projects, 1) > 0 AND NOT (NEW.project = ANY(v_profile.projects)) THEN
    RAISE EXCEPTION 'User is not assigned to project %', NEW.project USING ERRCODE = '42501';
  END IF;

  -- 6. Time and history checks
  IF TG_OP = 'INSERT' THEN
    IF NOT v_is_admin AND NEW.starts_at < (now() - interval '5 minutes') THEN
      RAISE EXCEPTION 'Cannot create bookings in the past' USING ERRCODE = '22023';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NOT v_is_admin AND OLD.ends_at < now() THEN
      RAISE EXCEPTION 'Cannot modify past bookings' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Re-attach trigger
DROP TRIGGER IF EXISTS tr_enforce_booking_rules ON public.bookings;
CREATE TRIGGER tr_enforce_booking_rules
  BEFORE INSERT OR UPDATE ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_booking_rules();

-- Atomic Multi-Slot Booking Update RPC (5-arg signature matching Dashboard)
CREATE OR REPLACE FUNCTION public.update_booking_group(
  p_old_ids bigint[],
  p_date date,
  p_start_time time,
  p_end_time time,
  p_project text
)
RETURNS public.bookings AS $$
DECLARE
  v_primary_id bigint;
  v_updated_booking public.bookings%ROWTYPE;
  v_first_booking public.bookings%ROWTYPE;
  v_is_admin boolean;
BEGIN
  IF p_old_ids IS NULL OR array_length(p_old_ids, 1) = 0 THEN
    RAISE EXCEPTION 'No booking IDs provided for update';
  END IF;

  v_primary_id := p_old_ids[1];
  v_is_admin := public.is_admin(auth.uid());

  SELECT * INTO v_first_booking FROM public.bookings
  WHERE id = v_primary_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found: %', v_primary_id;
  END IF;

  IF NOT v_is_admin AND v_first_booking.user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Unauthorized: not owner of booking %', v_primary_id;
  END IF;

  IF array_length(p_old_ids, 1) > 1 THEN
    DELETE FROM public.bookings
    WHERE id = ANY(p_old_ids[2:array_length(p_old_ids, 1)]);
  END IF;

  UPDATE public.bookings
  SET
    date = p_date,
    time = p_start_time,
    end_time = p_end_time,
    project = p_project
  WHERE id = v_primary_id
  RETURNING * INTO v_updated_booking;

  RETURN v_updated_booking;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.update_booking_group(bigint[], date, time, time, text) FROM public;
GRANT EXECUTE ON FUNCTION public.update_booking_group(bigint[], date, time, time, text) TO authenticated;

-- 8. Booking Confirmation & Rejection RPCs
CREATE OR REPLACE FUNCTION public.confirm_booking(p_booking_id bigint)
RETURNS jsonb AS $$
DECLARE
  v_caller_id uuid;
  v_booking record;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT (public.is_admin(v_caller_id) OR public.is_tool_responsible(v_caller_id, v_booking.tool_id)) THEN
    RAISE EXCEPTION 'Unauthorized: Only an Administrator or Tool Responsible can confirm bookings' USING ERRCODE = '42501';
  END IF;

  UPDATE public.bookings
  SET 
    status = 'confirmed',
    confirmed_by = v_caller_id,
    confirmed_at = timezone('utc'::text, now())
  WHERE id = p_booking_id;

  RETURN jsonb_build_object('success', true, 'booking_id', p_booking_id, 'status', 'confirmed');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.confirm_booking(bigint) FROM public;
GRANT EXECUTE ON FUNCTION public.confirm_booking(bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.reject_booking(p_booking_id bigint, p_reason text DEFAULT NULL)
RETURNS jsonb AS $$
DECLARE
  v_caller_id uuid;
  v_booking record;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT (public.is_admin(v_caller_id) OR public.is_tool_responsible(v_caller_id, v_booking.tool_id)) THEN
    RAISE EXCEPTION 'Unauthorized: Only an Administrator or Tool Responsible can reject bookings' USING ERRCODE = '42501';
  END IF;

  -- Delete the rejected booking so the tentative hold is released
  DELETE FROM public.bookings WHERE id = p_booking_id;

  RETURN jsonb_build_object('success', true, 'booking_id', p_booking_id, 'status', 'rejected', 'reason', p_reason);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.reject_booking(bigint, text) FROM public;
GRANT EXECUTE ON FUNCTION public.reject_booking(bigint, text) TO authenticated;

-- 9. Training Request Approval & Rejection RPCs
CREATE OR REPLACE FUNCTION public.approve_training_request(p_request_id bigint, p_notes text DEFAULT NULL)
RETURNS jsonb AS $$
DECLARE
  v_caller_id uuid;
  v_req record;
  v_target_profile record;
  v_new_licenses jsonb;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_req FROM public.training_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Training request not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT (public.is_admin(v_caller_id) OR public.is_tool_responsible(v_caller_id, v_req.tool_id)) THEN
    RAISE EXCEPTION 'Unauthorized: Only an Administrator or Tool Responsible can approve training requests' USING ERRCODE = '42501';
  END IF;

  -- 1. Update training request status
  UPDATE public.training_requests
  SET 
    status = 'approved',
    reviewed_by = v_caller_id,
    reviewed_at = timezone('utc'::text, now()),
    notes = COALESCE(p_notes, notes)
  WHERE id = p_request_id;

  -- 2. Training request approval starts with Level I always
  SELECT * INTO v_target_profile FROM public.profiles WHERE id = v_req.user_id;
  IF FOUND THEN
    IF jsonb_typeof(v_target_profile.licenses) = 'object' THEN
      v_new_licenses := v_target_profile.licenses || jsonb_build_object(v_req.tool_id::text, 'level_1');
    ELSE
      v_new_licenses := jsonb_build_object(v_req.tool_id::text, 'level_1');
    END IF;

    UPDATE public.profiles
    SET licenses = v_new_licenses, updated_at = timezone('utc'::text, now())
    WHERE id = v_req.user_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'request_id', p_request_id,
    'assigned_level', 'level_1',
    'tool_id', v_req.tool_id,
    'user_id', v_req.user_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.approve_training_request(bigint, text) FROM public;
GRANT EXECUTE ON FUNCTION public.approve_training_request(bigint, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.reject_training_request(p_request_id bigint, p_notes text DEFAULT NULL)
RETURNS jsonb AS $$
DECLARE
  v_caller_id uuid;
  v_req record;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_req FROM public.training_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Training request not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT (public.is_admin(v_caller_id) OR public.is_tool_responsible(v_caller_id, v_req.tool_id)) THEN
    RAISE EXCEPTION 'Unauthorized: Only an Administrator or Tool Responsible can reject training requests' USING ERRCODE = '42501';
  END IF;

  UPDATE public.training_requests
  SET 
    status = 'rejected',
    reviewed_by = v_caller_id,
    reviewed_at = timezone('utc'::text, now()),
    notes = COALESCE(p_notes, notes)
  WHERE id = p_request_id;

  RETURN jsonb_build_object('success', true, 'request_id', p_request_id, 'status', 'rejected');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.reject_training_request(bigint, text) FROM public;
GRANT EXECUTE ON FUNCTION public.reject_training_request(bigint, text) TO authenticated;

-- 10. RPC to Set User Access Level for a Tool (Admin or Tool Responsible)
CREATE OR REPLACE FUNCTION public.set_user_tool_license(
  p_user_id uuid,
  p_tool_id bigint,
  p_level text
)
RETURNS jsonb AS $$
DECLARE
  v_caller_id uuid;
  v_target_profile record;
  v_new_licenses jsonb;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NOT NULL AND NOT (public.is_admin(v_caller_id) OR public.is_tool_responsible(v_caller_id, p_tool_id)) THEN
    RAISE EXCEPTION 'Unauthorized: Only an Administrator or Tool Responsible can manage tool access levels' USING ERRCODE = '42501';
  END IF;

  IF p_level IS NOT NULL AND p_level NOT IN ('none', 'level_1', 'level_2', 'level_3') THEN
    RAISE EXCEPTION 'Invalid access level. Must be one of: none, level_1, level_2, level_3' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_target_profile FROM public.profiles WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User profile not found' USING ERRCODE = 'P0002';
  END IF;

  IF jsonb_typeof(v_target_profile.licenses) = 'object' THEN
    v_new_licenses := v_target_profile.licenses;
  ELSE
    v_new_licenses := '{}'::jsonb;
  END IF;

  IF p_level IS NULL OR p_level = 'none' THEN
    v_new_licenses := v_new_licenses - p_tool_id::text;
  ELSE
    v_new_licenses := v_new_licenses || jsonb_build_object(p_tool_id::text, p_level);
  END IF;

  UPDATE public.profiles
  SET licenses = v_new_licenses, updated_at = timezone('utc'::text, now())
  WHERE id = p_user_id;

  RETURN jsonb_build_object(
    'success', true,
    'user_id', p_user_id,
    'tool_id', p_tool_id,
    'access_level', COALESCE(p_level, 'none'),
    'licenses', v_new_licenses
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.set_user_tool_license(uuid, bigint, text) FROM public;
GRANT EXECUTE ON FUNCTION public.set_user_tool_license(uuid, bigint, text) TO authenticated;

-- 11. Row-Level Security for training_requests
ALTER TABLE public.training_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_requests FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "training_requests_select" ON public.training_requests;
DROP POLICY IF EXISTS "training_requests_insert" ON public.training_requests;
DROP POLICY IF EXISTS "training_requests_update" ON public.training_requests;
DROP POLICY IF EXISTS "training_requests_delete" ON public.training_requests;

CREATE POLICY "training_requests_select" ON public.training_requests
  FOR SELECT
  USING (
    auth.uid() IS NULL
    OR auth.uid() = user_id
    OR public.is_admin(auth.uid())
    OR public.is_tool_responsible(auth.uid(), tool_id)
  );

CREATE POLICY "training_requests_insert" ON public.training_requests
  FOR INSERT
  WITH CHECK (
    auth.uid() IS NULL
    OR (public.is_approved_user(auth.uid()) AND auth.uid() = user_id)
    OR public.is_admin(auth.uid())
  );

CREATE POLICY "training_requests_update" ON public.training_requests
  FOR UPDATE
  USING (
    auth.uid() IS NULL
    OR public.is_admin(auth.uid())
    OR public.is_tool_responsible(auth.uid(), tool_id)
  )
  WITH CHECK (
    auth.uid() IS NULL
    OR public.is_admin(auth.uid())
    OR public.is_tool_responsible(auth.uid(), tool_id)
  );

CREATE POLICY "training_requests_delete" ON public.training_requests
  FOR DELETE
  USING (
    auth.uid() IS NULL
    OR auth.uid() = user_id
    OR public.is_admin(auth.uid())
    OR public.is_tool_responsible(auth.uid(), tool_id)
  );
