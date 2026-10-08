-- Add calendar_token to profiles table
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'profiles'
  ) THEN
    ALTER TABLE public.profiles 
    ADD COLUMN IF NOT EXISTS calendar_token text UNIQUE;

    CREATE INDEX IF NOT EXISTS idx_profiles_calendar_token ON public.profiles(calendar_token);
  END IF;
END $$;
