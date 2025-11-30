-- Add is_approved column to profiles table
alter table profiles 
add column is_approved boolean default false;

-- Update existing users to be approved by default so we don't lock everyone out
update profiles 
set is_approved = true;

-- Update handle_new_user function to set is_approved to false for new users (explicitly, though default handles it)
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, first_name, last_name, job_title, access_level, licenses, is_approved)
  values (
    new.id,
    new.raw_user_meta_data->>'first_name',
    new.raw_user_meta_data->>'last_name',
    new.raw_user_meta_data->>'job_title',
    coalesce(new.raw_user_meta_data->>'access_level', 'user'),
    '[]'::jsonb,
    false -- New users are not approved by default
  );
  return new;
end;
$$ language plpgsql security definer;
