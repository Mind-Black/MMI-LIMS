-- Enable RLS on tools table
alter table tools enable row level security;

-- Allow everyone to view tools
create policy "Tools are viewable by everyone" 
on tools for select 
using (true);

-- Allow admins to update tools
create policy "Admins can update tools" 
on tools for update 
using (
  exists (
    select 1 from profiles 
    where profiles.id = auth.uid() 
    and profiles.access_level = 'admin'
  )
);
