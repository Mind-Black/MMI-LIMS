-- ==============================================================================
-- 20260929000001_infrastructure_management.sql
-- Infrastructure creation, image support, and RLS policy hardening
-- ==============================================================================

-- 1. Ensure image_url and created_at columns exist on public.tools
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'tools' AND column_name = 'image_url'
  ) THEN
    ALTER TABLE public.tools ADD COLUMN image_url text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'tools' AND column_name = 'created_at'
  ) THEN
    ALTER TABLE public.tools ADD COLUMN created_at timestamptz DEFAULT timezone('utc'::text, now());
  END IF;
END $$;

-- 2. Ensure explicit WITH CHECK on public.tools for admins and system roles
ALTER TABLE public.tools ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tools_read_all" ON public.tools;
DROP POLICY IF EXISTS "tools_admin_all" ON public.tools;

CREATE POLICY "tools_read_all" ON public.tools
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "tools_admin_all" ON public.tools
  FOR ALL
  USING (auth.uid() IS NULL OR public.is_admin(auth.uid()))
  WITH CHECK (auth.uid() IS NULL OR public.is_admin(auth.uid()));
