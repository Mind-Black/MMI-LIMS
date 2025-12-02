-- Allow admins to update any profile (required for license management)
create policy "Admins can update any profile" on profiles for update using (
  exists (select 1 from profiles where id = auth.uid() and access_level = 'admin')
);
