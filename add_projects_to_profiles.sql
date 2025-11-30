-- Add projects column to profiles table
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS projects text[] DEFAULT '{}';

-- Update handle_new_user function to initialize projects as empty array
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, first_name, last_name, job_title, access_level, licenses, projects)
  VALUES (
    new.id,
    new.raw_user_meta_data->>'first_name',
    new.raw_user_meta_data->>'last_name',
    new.raw_user_meta_data->>'job_title',
    COALESCE(new.raw_user_meta_data->>'access_level', 'user'),
    '[]'::jsonb,
    '{}'
  );
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
