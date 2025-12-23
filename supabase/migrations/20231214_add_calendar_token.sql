-- Add calendar_token to profiles table
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS calendar_token text UNIQUE;

-- Create an index for faster lookups
CREATE INDEX IF NOT EXISTS idx_profiles_calendar_token ON profiles(calendar_token);
