-- Support an unrevocable Super Admin profile without storing any personal email in source control.
-- Provision via either:
--   1. Supabase Vault secret named 'mmi_super_admin_email' (used on migration and future signups), or
--   2. Privileged SQL in the database console setting is_super_admin = true, access_level = 'admin', is_approved = true.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_super_admin boolean NOT NULL DEFAULT false;

-- 1. Private helper reading optional Vault secret (returns NULL when Vault or secret is absent).
CREATE OR REPLACE FUNCTION public.get_configured_super_admin_email()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text;
BEGIN
  IF to_regclass('vault.decrypted_secrets') IS NULL THEN
    RETURN NULL;
  END IF;

  EXECUTE $q$
    SELECT lower(btrim(decrypted_secret))
    FROM vault.decrypted_secrets
    WHERE name = 'mmi_super_admin_email'
    LIMIT 1
  $q$ INTO v_email;

  RETURN NULLIF(v_email, '');
END;
$$;

REVOKE ALL ON FUNCTION public.get_configured_super_admin_email() FROM PUBLIC, anon, authenticated;

-- 2. Authoritative Super Admin check backed by the immutable profiles.is_super_admin flag.
CREATE OR REPLACE FUNCTION public.is_super_admin(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_user_id IS NULL THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = p_user_id
      AND is_super_admin = true
      AND access_level = 'admin'
      AND is_approved = true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.is_super_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_super_admin(uuid) TO authenticated;

-- 3. Backfill configured Super Admin if Vault secret 'mmi_super_admin_email' is present.
DO $$
DECLARE
  v_super_email text;
BEGIN
  v_super_email := public.get_configured_super_admin_email();
  IF v_super_email IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.profiles (
    id, first_name, last_name, job_title, email, access_level, is_approved, is_super_admin
  )
  SELECT
    u.id,
    NULLIF(btrim(u.raw_user_meta_data->>'first_name'), ''),
    NULLIF(btrim(u.raw_user_meta_data->>'last_name'), ''),
    NULLIF(btrim(u.raw_user_meta_data->>'job_title'), ''),
    u.email,
    'admin',
    true,
    true
  FROM auth.users u
  WHERE lower(btrim(COALESCE(u.email, ''))) = v_super_email
  ON CONFLICT (id) DO UPDATE SET
    access_level = 'admin',
    is_approved = true,
    is_super_admin = true,
    email = COALESCE(NULLIF(btrim(public.profiles.email), ''), EXCLUDED.email),
    updated_at = timezone('utc'::text, now());
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'profiles_super_admin_invariants'
      AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_super_admin_invariants
      CHECK (NOT is_super_admin OR (access_level = 'admin' AND is_approved = true));
  END IF;
END;
$$;

-- 4. Include super-admin in admin & approval checks.
CREATE OR REPLACE FUNCTION public.is_admin(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_user_id IS NULL THEN
    RETURN false;
  END IF;
  RETURN public.is_super_admin(p_user_id) OR EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = p_user_id
      AND access_level = 'admin'
      AND is_approved = true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.is_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.is_approved_user(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_user_id IS NULL THEN
    RETURN false;
  END IF;
  RETURN public.is_super_admin(p_user_id) OR EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = p_user_id
      AND is_approved = true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.is_approved_user(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_approved_user(uuid) TO authenticated;

-- 5. Auto-provision configured Super Admin on signup / invitation acceptance when Vault secret is set.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv public.user_invitations;
  v_email text;
  v_super_email text;
  v_first_name text;
  v_last_name text;
  v_job_title text;
  v_approved boolean := false;
  v_access_level text := 'user';
  v_is_super_admin boolean := false;
  v_projects text[] := '{}'::text[];
BEGIN
  v_email := lower(btrim(COALESCE(NEW.email, '')));
  v_super_email := public.get_configured_super_admin_email();
  v_first_name := NULLIF(btrim(NEW.raw_user_meta_data->>'first_name'), '');
  v_last_name := NULLIF(btrim(NEW.raw_user_meta_data->>'last_name'), '');
  v_job_title := NULLIF(btrim(NEW.raw_user_meta_data->>'job_title'), '');

  IF v_email <> '' THEN
    SELECT * INTO v_inv
    FROM public.user_invitations
    WHERE email = v_email
      AND status = 'pending'
      AND expires_at > now()
    FOR UPDATE;

    IF FOUND THEN
      v_approved := true;
      v_first_name := COALESCE(v_first_name, NULLIF(btrim(v_inv.first_name), ''));
      v_last_name := COALESCE(v_last_name, NULLIF(btrim(v_inv.last_name), ''));
      v_job_title := COALESCE(v_job_title, NULLIF(btrim(v_inv.job_title), ''));
      v_projects := COALESCE(v_inv.projects, '{}'::text[]);

      UPDATE public.user_invitations
      SET status = 'accepted',
          accepted_at = now(),
          invited_user_id = NEW.id
      WHERE id = v_inv.id;
    END IF;
  END IF;

  IF v_super_email IS NOT NULL AND v_email = v_super_email THEN
    v_approved := true;
    v_access_level := 'admin';
    v_is_super_admin := true;
  END IF;

  INSERT INTO public.profiles(id, first_name, last_name, job_title, email, access_level, is_approved, is_super_admin, projects)
  VALUES(NEW.id, v_first_name, v_last_name, v_job_title, NEW.email, v_access_level, v_approved, v_is_super_admin, v_projects)
  ON CONFLICT(id) DO UPDATE SET
    access_level = CASE WHEN EXCLUDED.is_super_admin THEN 'admin' ELSE public.profiles.access_level END,
    is_approved = CASE WHEN EXCLUDED.is_super_admin THEN true ELSE public.profiles.is_approved END,
    is_super_admin = CASE WHEN EXCLUDED.is_super_admin THEN true ELSE public.profiles.is_super_admin END;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- 6. Make super-admin privileges unrevocable and protect is_super_admin & email from tampering.
CREATE OR REPLACE FUNCTION public.enforce_profile_update_rules()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL AND current_setting('role', true) IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'Authenticated identity required' USING ERRCODE = '42501';
  END IF;

  IF OLD.is_super_admin THEN
    IF NEW.access_level IS DISTINCT FROM 'admin'
       OR NEW.is_approved IS DISTINCT FROM true
       OR NEW.is_super_admin IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'Unauthorized: super-admin privileges cannot be revoked' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NEW.is_super_admin IS DISTINCT FROM OLD.is_super_admin THEN
    IF NOT (
      auth.uid() IS NULL
      AND NEW.is_super_admin = true
      AND NEW.access_level = 'admin'
      AND NEW.is_approved = true
    ) THEN
      RAISE EXCEPTION 'Unauthorized: cannot modify is_super_admin' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF auth.uid() IS NULL THEN
    -- Direct SQL editor / service_role / migrations
    NEW.updated_at := timezone('utc'::text, now());
    RETURN NEW;
  END IF;

  IF public.is_admin(auth.uid()) THEN
    IF NEW.access_level IS DISTINCT FROM OLD.access_level THEN
      IF OLD.id = auth.uid() THEN
        RAISE EXCEPTION 'Unauthorized: cannot modify your own access_level' USING ERRCODE = '42501';
      END IF;
      IF NEW.access_level = 'admin' AND NOT NEW.is_approved THEN
        RAISE EXCEPTION 'User must be approved before being granted admin access' USING ERRCODE = '22023';
      END IF;
      IF OLD.access_level = 'admin' AND NEW.access_level <> 'admin' THEN
        IF NOT EXISTS (
          SELECT 1
          FROM public.profiles
          WHERE access_level = 'admin'
            AND is_approved = true
            AND id <> OLD.id
        ) THEN
          RAISE EXCEPTION 'Cannot remove the last administrator' USING ERRCODE = '22023';
        END IF;
      END IF;
    ELSIF NEW.access_level = 'admin' AND NOT NEW.is_approved THEN
      IF OLD.is_approved THEN
        RAISE EXCEPTION 'Cannot unapprove an administrator; revoke admin access first' USING ERRCODE = '22023';
      END IF;
    END IF;

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
  IF NEW.email IS DISTINCT FROM OLD.email THEN
    RAISE EXCEPTION 'Unauthorized: cannot modify email' USING ERRCODE = '42501';
  END IF;
  IF NEW.licenses IS DISTINCT FROM OLD.licenses AND (
    NOT public.is_approved_user(auth.uid()) OR EXISTS (
      SELECT 1
      FROM (
        SELECT key FROM jsonb_each(OLD.licenses)
        UNION
        SELECT key FROM jsonb_each(NEW.licenses)
      ) keys
      WHERE OLD.licenses->keys.key IS DISTINCT FROM NEW.licenses->keys.key
        AND NOT public.is_tool_responsible(auth.uid(), keys.key::bigint)
    )
  ) THEN
    RAISE EXCEPTION 'Unauthorized: cannot modify licenses' USING ERRCODE = '42501';
  END IF;
  IF NEW.projects IS DISTINCT FROM OLD.projects THEN
    RAISE EXCEPTION 'Unauthorized: cannot modify projects' USING ERRCODE = '42501';
  END IF;

  NEW.updated_at := timezone('utc'::text, now());
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_profile_update_rules() FROM PUBLIC, anon, authenticated;

-- 7. Prevent deleting the super-admin profile.
CREATE OR REPLACE FUNCTION public.prevent_super_admin_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.is_super_admin THEN
    RAISE EXCEPTION 'Unauthorized: super-admin account cannot be deleted' USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_super_admin_delete() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE TRIGGER tr_prevent_super_admin_delete
  BEFORE DELETE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_super_admin_delete();

-- 8. Reject super-admin modification in set_user_access_level RPC.
CREATE OR REPLACE FUNCTION public.set_user_access_level(
  p_user_id uuid,
  p_access_level text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id uuid;
  v_target public.profiles;
  v_other_admin_exists boolean;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL OR NOT public.is_approved_user(v_caller_id) OR NOT public.is_admin(v_caller_id) THEN
    RAISE EXCEPTION 'Admin required' USING ERRCODE = '42501';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Target user is required' USING ERRCODE = '22023';
  END IF;

  IF p_access_level IS NULL OR p_access_level NOT IN ('user', 'admin') THEN
    RAISE EXCEPTION 'Invalid access level. Must be user or admin' USING ERRCODE = '22023';
  END IF;

  -- Lock target user and all approved admins in deterministic order to prevent concurrent last-admin removal.
  PERFORM 1
  FROM public.profiles
  WHERE id = p_user_id OR (access_level = 'admin' AND is_approved = true)
  ORDER BY id
  FOR UPDATE;

  SELECT * INTO v_target
  FROM public.profiles
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User profile not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_target.is_super_admin THEN
    RAISE EXCEPTION 'Unauthorized: super-admin privileges cannot be revoked' USING ERRCODE = '42501';
  END IF;

  IF p_user_id = v_caller_id THEN
    RAISE EXCEPTION 'Cannot change your own access level' USING ERRCODE = '42501';
  END IF;

  IF p_access_level = 'admin' AND NOT v_target.is_approved THEN
    RAISE EXCEPTION 'User must be approved before being granted admin access' USING ERRCODE = '22023';
  END IF;

  IF v_target.access_level = 'admin' AND p_access_level <> 'admin' THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE access_level = 'admin'
        AND is_approved = true
        AND id <> p_user_id
    ) INTO v_other_admin_exists;

    IF NOT v_other_admin_exists THEN
      RAISE EXCEPTION 'Cannot remove the last administrator' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF v_target.access_level IS DISTINCT FROM p_access_level THEN
    UPDATE public.profiles
    SET access_level = p_access_level
    WHERE id = p_user_id
    RETURNING * INTO v_target;
  END IF;

  RETURN jsonb_build_object(
    'id', v_target.id,
    'access_level', v_target.access_level,
    'is_approved', v_target.is_approved,
    'is_super_admin', v_target.is_super_admin
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_user_access_level(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_user_access_level(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
