-- ==============================================================================
-- 20260927000001_security_and_constraints.sql
-- Forward Migration for Existing Deployments:
-- 1. Migrate legacy calendar tokens to user_calendar_tokens
-- 2. Backfill booking range columns (end_time, starts_at, ends_at)
-- 3. Install btree_gist and enforce range exclusion constraint
-- 4. Close public data exposure (S1, S2, S3, S5)
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Create user_calendar_tokens table if not exists
CREATE TABLE IF NOT EXISTS public.user_calendar_tokens (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);
CREATE INDEX IF NOT EXISTS idx_calendar_tokens_hash ON public.user_calendar_tokens(token_hash);

-- 2. Migrate existing plaintext calendar tokens from profiles (if column exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'calendar_token'
  ) THEN
    -- Migrate existing tokens by hashing them with SHA-256
    INSERT INTO public.user_calendar_tokens (user_id, token_hash, created_at)
    SELECT 
      id AS user_id, 
      encode(digest(calendar_token, 'sha256'), 'hex') AS token_hash,
      timezone('utc'::text, now())
    FROM public.profiles
    WHERE calendar_token IS NOT NULL AND calendar_token <> ''
    ON CONFLICT (user_id) DO NOTHING;

    -- Drop legacy index and column from profiles
    DROP INDEX IF EXISTS idx_profiles_calendar_token;
    ALTER TABLE public.profiles DROP COLUMN IF EXISTS calendar_token;
  END IF;
END $$;

-- 3. Ensure bookings has end_time, starts_at, ends_at columns
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'bookings' AND column_name = 'end_time'
  ) THEN
    ALTER TABLE public.bookings ADD COLUMN end_time time;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'bookings' AND column_name = 'starts_at'
  ) THEN
    ALTER TABLE public.bookings ADD COLUMN starts_at timestamptz;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'bookings' AND column_name = 'ends_at'
  ) THEN
    ALTER TABLE public.bookings ADD COLUMN ends_at timestamptz;
  END IF;
END $$;

-- 4. Backfill legacy bookings missing end_time or range timestamps
UPDATE public.bookings
SET end_time = (time::time + interval '30 minutes')::time
WHERE end_time IS NULL;

UPDATE public.bookings
SET
  starts_at = (date::text || ' ' || time::text)::timestamp AT TIME ZONE 'Europe/Vilnius',
  ends_at = (date::text || ' ' || end_time::text)::timestamp AT TIME ZONE 'Europe/Vilnius'
WHERE starts_at IS NULL OR ends_at IS NULL;

-- Enforce NOT NULL on range columns
ALTER TABLE public.bookings ALTER COLUMN end_time SET NOT NULL;
ALTER TABLE public.bookings ALTER COLUMN starts_at SET NOT NULL;
ALTER TABLE public.bookings ALTER COLUMN ends_at SET NOT NULL;

-- Add check constraints
ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS booking_time_order;
ALTER TABLE public.bookings ADD CONSTRAINT booking_time_order CHECK (end_time > time);

ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS booking_starts_ends_order;
ALTER TABLE public.bookings ADD CONSTRAINT booking_starts_ends_order CHECK (ends_at > starts_at);

-- Add exclusion constraint for double booking prevention (S5)
ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS no_double_booking;
ALTER TABLE public.bookings ADD CONSTRAINT no_double_booking EXCLUDE USING gist (
  tool_id WITH =,
  tstzrange(starts_at, ends_at, '[)') WITH &&
);

-- Indexes for performance (P1)
CREATE INDEX IF NOT EXISTS idx_bookings_tool_date ON public.bookings(tool_id, date);
CREATE INDEX IF NOT EXISTS idx_bookings_user_date ON public.bookings(user_id, date);
CREATE INDEX IF NOT EXISTS idx_bookings_starts_at ON public.bookings(starts_at);
CREATE INDEX IF NOT EXISTS idx_profiles_approved ON public.profiles(is_approved);

-- 5. Non-recursive Admin Check Helper Function
CREATE OR REPLACE FUNCTION public.is_admin(p_user_id uuid)
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = p_user_id AND access_level = 'admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.is_admin(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO authenticated;

-- 6. Safe Profile Update Validation Trigger
CREATE OR REPLACE FUNCTION public.enforce_profile_update_rules()
RETURNS trigger AS $$
BEGIN
  IF public.is_admin(auth.uid()) THEN
    NEW.updated_at := timezone('utc'::text, now());
    RETURN NEW;
  END IF;

  IF NEW.access_level IS DISTINCT FROM OLD.access_level THEN
    RAISE EXCEPTION 'Unauthorized: cannot modify access_level';
  END IF;
  IF NEW.is_approved IS DISTINCT FROM OLD.is_approved THEN
    RAISE EXCEPTION 'Unauthorized: cannot modify is_approved';
  END IF;
  IF NEW.licenses IS DISTINCT FROM OLD.licenses THEN
    RAISE EXCEPTION 'Unauthorized: cannot modify licenses';
  END IF;
  IF NEW.projects IS DISTINCT FROM OLD.projects THEN
    RAISE EXCEPTION 'Unauthorized: cannot modify projects';
  END IF;

  NEW.updated_at := timezone('utc'::text, now());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_enforce_profile_update_rules ON public.profiles;
CREATE TRIGGER trg_enforce_profile_update_rules
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_profile_update_rules();

-- 7. Hardcode ordinary user on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (
    id,
    first_name,
    last_name,
    job_title,
    access_level,
    is_approved,
    licenses,
    projects
  )
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'last_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'job_title', 'Researcher'),
    'user',
    false,
    '[]'::jsonb,
    '{}'::text[]
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 8. Authoritative Booking Validation and Timestamp Assignment Trigger
CREATE OR REPLACE FUNCTION public.validate_and_set_booking_range()
RETURNS trigger AS $$
DECLARE
  v_user_profile public.profiles%ROWTYPE;
  v_tool public.tools%ROWTYPE;
  v_is_admin boolean;
  v_lab_timezone text := 'Europe/Vilnius';
BEGIN
  v_is_admin := public.is_admin(COALESCE(auth.uid(), NEW.user_id));

  SELECT * INTO v_user_profile FROM public.profiles WHERE id = NEW.user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking user profile not found';
  END IF;

  SELECT * INTO v_tool FROM public.tools WHERE id = NEW.tool_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tool not found';
  END IF;

  NEW.user_name := TRIM(COALESCE(v_user_profile.first_name, '') || ' ' || COALESCE(v_user_profile.last_name, ''));
  IF NEW.user_name = '' THEN
    NEW.user_name := 'User ' || SUBSTRING(NEW.user_id::text, 1, 8);
  END IF;
  NEW.tool_name := v_tool.name;

  IF NEW.end_time IS NULL THEN
    NEW.end_time := (NEW.time + interval '30 minutes')::time;
  END IF;

  IF NEW.end_time <= NEW.time THEN
    RAISE EXCEPTION 'end_time (%) must be after time (%)', NEW.end_time, NEW.time;
  END IF;

  NEW.starts_at := (NEW.date::text || ' ' || NEW.time::text)::timestamp AT TIME ZONE v_lab_timezone;
  NEW.ends_at := (NEW.date::text || ' ' || NEW.end_time::text)::timestamp AT TIME ZONE v_lab_timezone;

  IF NOT v_is_admin THEN
    IF auth.uid() IS NOT NULL AND NEW.user_id <> auth.uid() THEN
      RAISE EXCEPTION 'Unauthorized: cannot create or modify bookings for another user';
    END IF;

    IF NOT v_user_profile.is_approved THEN
      RAISE EXCEPTION 'User account is pending administrator approval';
    END IF;

    IF v_tool.status <> 'up' THEN
      RAISE EXCEPTION 'Tool is currently unavailable (status: %)', v_tool.status;
    END IF;

    IF v_tool.license_req THEN
      IF NOT (v_user_profile.licenses @> to_jsonb(v_tool.id)) THEN
        RAISE EXCEPTION 'License required for tool %', v_tool.name;
      END IF;
    END IF;

    IF NEW.ends_at < timezone('utc'::text, now()) THEN
      RAISE EXCEPTION 'Cannot create or modify past bookings';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_validate_and_set_booking_range ON public.bookings;
CREATE TRIGGER trg_validate_and_set_booking_range
  BEFORE INSERT OR UPDATE ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_and_set_booking_range();

-- 9. Atomic Group Booking Update RPC (L1)
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

-- 10. Calendar Token RPCs
CREATE OR REPLACE FUNCTION public.rotate_calendar_token(p_token_hash text)
RETURNS boolean AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF p_token_hash IS NULL OR length(p_token_hash) < 32 THEN
    RAISE EXCEPTION 'Invalid token hash';
  END IF;

  INSERT INTO public.user_calendar_tokens (user_id, token_hash, created_at)
  VALUES (auth.uid(), p_token_hash, timezone('utc'::text, now()))
  ON CONFLICT (user_id) DO UPDATE
  SET
    token_hash = EXCLUDED.token_hash,
    created_at = timezone('utc'::text, now());

  RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.rotate_calendar_token(text) FROM public;
GRANT EXECUTE ON FUNCTION public.rotate_calendar_token(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.revoke_calendar_token()
RETURNS boolean AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  DELETE FROM public.user_calendar_tokens WHERE user_id = auth.uid();
  RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.revoke_calendar_token() FROM public;
GRANT EXECUTE ON FUNCTION public.revoke_calendar_token() TO authenticated;

CREATE OR REPLACE FUNCTION public.has_calendar_token()
RETURNS boolean AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.user_calendar_tokens WHERE user_id = auth.uid()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.has_calendar_token() FROM public;
GRANT EXECUTE ON FUNCTION public.has_calendar_token() TO authenticated;

-- 11. Replace Insecure Policies (S1, S2, S3)
-- Drop unsafe public SELECT policies
DROP POLICY IF EXISTS "Bookings are viewable by everyone" ON public.bookings;
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON public.profiles;
DROP POLICY IF EXISTS "Tools are viewable by everyone" ON public.tools;

-- Ensure authenticated-only SELECT
DROP POLICY IF EXISTS "Tools viewable by authenticated users" ON public.tools;
CREATE POLICY "Tools viewable by authenticated users" ON public.tools
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Profiles viewable by authenticated users" ON public.profiles;
CREATE POLICY "Profiles viewable by authenticated users" ON public.profiles
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Bookings viewable by authenticated users" ON public.bookings;
CREATE POLICY "Bookings viewable by authenticated users" ON public.bookings
  FOR SELECT USING (auth.role() = 'authenticated');

-- Calendar token table policies
ALTER TABLE public.user_calendar_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Calendar token access restricted to owner" ON public.user_calendar_tokens;
CREATE POLICY "Calendar token access restricted to owner" ON public.user_calendar_tokens
  FOR ALL USING (auth.uid() = user_id);
