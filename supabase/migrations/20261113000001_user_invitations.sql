-- Administrator email invitations for pre-approved user onboarding.

CREATE TABLE public.user_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL CHECK (email = lower(btrim(email)) AND length(email) BETWEEN 3 AND 320 AND position('@' in email) > 1),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  first_name text,
  last_name text,
  job_title text,
  projects text[] NOT NULL DEFAULT '{}'::text[],
  invited_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  invited_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked')),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  last_sent_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX user_invitations_pending_email_idx
  ON public.user_invitations (email)
  WHERE status = 'pending';

CREATE INDEX user_invitations_status_created_idx
  ON public.user_invitations (status, created_at DESC);

ALTER TABLE public.user_invitations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.user_invitations FROM PUBLIC, anon, authenticated;
GRANT SELECT (
  id, email, first_name, last_name, job_title, projects,
  invited_by, invited_user_id, status, expires_at, last_sent_at,
  accepted_at, created_at
) ON public.user_invitations TO authenticated;

CREATE POLICY user_invitations_admin_read
  ON public.user_invitations
  FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.revoke_user_invitation(p_invitation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv public.user_invitations;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_approved_user(auth.uid()) OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Admin required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_inv
  FROM public.user_invitations
  WHERE id = p_invitation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found' USING ERRCODE = '22023';
  END IF;

  IF v_inv.status <> 'pending' THEN
    RAISE EXCEPTION 'Invitation is no longer pending' USING ERRCODE = '22023';
  END IF;

  UPDATE public.user_invitations
  SET status = 'revoked'
  WHERE id = v_inv.id
  RETURNING * INTO v_inv;

  RETURN jsonb_build_object('id', v_inv.id, 'status', v_inv.status);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_invitation_by_token(p_token_hash text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv public.user_invitations;
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_inv
  FROM public.user_invitations
  WHERE token_hash = p_token_hash
    AND status = 'pending'
    AND expires_at > now();

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'id', v_inv.id,
    'email', v_inv.email,
    'first_name', v_inv.first_name,
    'last_name', v_inv.last_name,
    'job_title', v_inv.job_title,
    'projects', to_jsonb(v_inv.projects),
    'expires_at', v_inv.expires_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_user_invitation(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_user_invitation(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.get_invitation_by_token(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_invitation_by_token(text) TO anon, authenticated;

-- Update handle_new_user() to match pending, unexpired invitations by normalized email
-- and auto-approve invited users with their pre-assigned projects and profile fields.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv public.user_invitations;
  v_email text;
  v_first_name text;
  v_last_name text;
  v_job_title text;
  v_approved boolean := false;
  v_projects text[] := '{}'::text[];
BEGIN
  v_email := lower(btrim(COALESCE(NEW.email, '')));
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

  INSERT INTO public.profiles(id, first_name, last_name, job_title, email, access_level, is_approved, projects)
  VALUES(NEW.id, v_first_name, v_last_name, v_job_title, NEW.email, 'user', v_approved, v_projects)
  ON CONFLICT(id) DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
