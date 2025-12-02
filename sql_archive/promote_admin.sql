-- Replace 'user_email_here' with the actual email of the user you want to promote
update profiles
set access_level = 'admin'
where id = (select id from auth.users where email = 'user_email_here');
