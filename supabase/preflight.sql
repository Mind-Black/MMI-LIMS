-- Read-only: save this output with the release record. No user data values are selected.
SELECT version,name FROM supabase_migrations.schema_migrations ORDER BY version;
SELECT tablename,policyname,roles,cmd,qual,with_check FROM pg_policies WHERE schemaname='public';
SELECT grantee,table_name,privilege_type FROM information_schema.role_table_grants WHERE table_schema='public' AND grantee IN ('anon','authenticated');
SELECT proname,pg_get_function_identity_arguments(oid) FROM pg_proc WHERE pronamespace='public'::regnamespace;
SELECT event_object_schema,event_object_table,trigger_name,action_statement FROM information_schema.triggers WHERE event_object_schema IN ('auth','public');
SELECT jsonb_typeof(licenses) AS license_shape,count(*) FROM profiles GROUP BY 1;
SELECT count(*) AS missing_profiles FROM auth.users u LEFT JOIN profiles p ON p.id=u.id WHERE p.id IS NULL;
SELECT count(*) AS invalid_intervals FROM bookings WHERE starts_at IS NULL OR ends_at IS NULL OR ends_at<=starts_at;
SELECT count(*) AS overlaps FROM bookings a JOIN bookings b ON a.id<b.id AND a.tool_id=b.tool_id AND tstzrange(a.starts_at,a.ends_at,'[)') && tstzrange(b.starts_at,b.ends_at,'[)');
SELECT count(*) AS invalid_license_references FROM profiles p CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(p.licenses)='array' THEN p.licenses ELSE '[]' END) x WHERE NOT EXISTS(SELECT 1 FROM tools WHERE id::text=x #>> '{}');
