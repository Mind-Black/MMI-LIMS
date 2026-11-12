-- Tool writes are admin-only. The previous policy also admitted any caller whose
-- auth.uid() is NULL and applied to every role; it was safe only because anon has
-- no table grants. Service role and the table owner bypass RLS, so they are unaffected.
DROP POLICY IF EXISTS "tools_admin_all" ON public.tools;
CREATE POLICY "tools_admin_all" ON public.tools
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- Remove hand-made policies found in production that no migration defines.
-- Each duplicates a migration-managed policy (tools_read_all, tools_admin_all,
-- user_calendar_tokens_owner); left in place they would silently keep access
-- open if those policies are ever tightened. No-ops on fresh databases.
DROP POLICY IF EXISTS "Admins can update tools" ON public.tools;
DROP POLICY IF EXISTS "Public tools are viewable by everyone" ON public.tools;
DROP POLICY IF EXISTS "Tools viewable by authenticated users" ON public.tools;
DROP POLICY IF EXISTS "Calendar token access restricted to owner" ON public.user_calendar_tokens;
