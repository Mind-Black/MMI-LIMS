-- Secure administrator role management with strict database invariants.

-- 1. Require admin accounts to also be approved before granting admin privileges.
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
  RETURN EXISTS (
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

-- 2. Enforce role transition invariants on direct profile updates as well.
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

-- 3. Dedicated RPC for approved admins to promote or demote other approved users.
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

  IF p_user_id = v_caller_id THEN
    RAISE EXCEPTION 'Cannot change your own access level' USING ERRCODE = '42501';
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
    'is_approved', v_target.is_approved
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_user_access_level(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_user_access_level(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
