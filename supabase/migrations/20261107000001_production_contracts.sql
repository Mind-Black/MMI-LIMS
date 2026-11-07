-- Forward-only repair of application contracts. Run preflight.sql before deployment.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS job_title text;
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 INSERT INTO public.profiles(id,first_name,last_name,job_title,email,access_level,is_approved)
 VALUES(NEW.id,NEW.raw_user_meta_data->>'first_name',NEW.raw_user_meta_data->>'last_name',NEW.raw_user_meta_data->>'job_title',NEW.email,'user',false)
 ON CONFLICT(id) DO NOTHING;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
INSERT INTO public.profiles(id,first_name,last_name,job_title,email)
SELECT id,raw_user_meta_data->>'first_name',raw_user_meta_data->>'last_name',raw_user_meta_data->>'job_title',email FROM auth.users ON CONFLICT(id) DO NOTHING;

-- Remove all historical permissive policies on these tables, including archive-era names.
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT tablename,policyname FROM pg_policies WHERE schemaname='public' AND tablename IN ('profiles','bookings') LOOP
 EXECUTE format('DROP POLICY %I ON public.%I',r.policyname,r.tablename);
 END LOOP;
END $$;
REVOKE ALL ON public.profiles,public.bookings,public.tools,public.user_calendar_tokens,public.cancellation_events,public.email_logs FROM anon;
REVOKE ALL ON public.profiles,public.bookings,public.tools FROM authenticated;
GRANT SELECT,UPDATE ON public.profiles TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.bookings TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.tools TO authenticated;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated;
CREATE POLICY profiles_read ON public.profiles FOR SELECT TO authenticated USING(auth.uid()=id OR public.is_approved_user(auth.uid()) OR public.is_admin(auth.uid()));
CREATE POLICY profiles_update ON public.profiles FOR UPDATE TO authenticated USING(auth.uid()=id OR public.is_admin(auth.uid())) WITH CHECK(auth.uid()=id OR public.is_admin(auth.uid()));
CREATE POLICY bookings_read ON public.bookings FOR SELECT TO authenticated USING(public.is_approved_user(auth.uid()) OR public.is_admin(auth.uid()));
CREATE POLICY bookings_insert ON public.bookings FOR INSERT TO authenticated WITH CHECK(public.is_approved_user(auth.uid()) AND (auth.uid()=user_id OR public.is_admin(auth.uid()) OR public.is_tool_responsible(auth.uid(),tool_id)));
CREATE POLICY bookings_update ON public.bookings FOR UPDATE TO authenticated USING(public.is_approved_user(auth.uid()) AND (auth.uid()=user_id OR public.is_admin(auth.uid()) OR public.is_tool_responsible(auth.uid(),tool_id))) WITH CHECK(public.is_approved_user(auth.uid()) AND (auth.uid()=user_id OR public.is_admin(auth.uid()) OR public.is_tool_responsible(auth.uid(),tool_id)));
CREATE POLICY bookings_delete ON public.bookings FOR DELETE TO authenticated USING(public.is_approved_user(auth.uid()) AND (auth.uid()=user_id OR public.is_admin(auth.uid()) OR public.is_tool_responsible(auth.uid(),tool_id)));

CREATE OR REPLACE FUNCTION public.enforce_profile_update_rules()
RETURNS trigger AS $$
BEGIN
  IF auth.uid() IS NULL AND current_setting('role',true) IN ('anon','authenticated') THEN
    RAISE EXCEPTION 'Authenticated identity required' USING ERRCODE='42501';
  END IF;
  IF auth.uid() IS NULL OR public.is_admin(auth.uid()) THEN
    NEW.updated_at := timezone('utc'::text, now());
    RETURN NEW;
  END IF;

  -- Non-admin self-service edit rules
  IF NEW.access_level IS DISTINCT FROM OLD.access_level THEN
    RAISE EXCEPTION 'Unauthorized: cannot modify access_level' USING ERRCODE = '42501';
  END IF;
  IF NEW.is_approved IS DISTINCT FROM OLD.is_approved THEN
    RAISE EXCEPTION 'Unauthorized: cannot modify is_approved' USING ERRCODE = '42501';
  END IF;
  IF NEW.licenses IS DISTINCT FROM OLD.licenses AND (
    NOT public.is_approved_user(auth.uid()) OR EXISTS(
      SELECT 1 FROM (SELECT key FROM jsonb_each(OLD.licenses) UNION SELECT key FROM jsonb_each(NEW.licenses)) keys
      WHERE OLD.licenses->keys.key IS DISTINCT FROM NEW.licenses->keys.key AND NOT public.is_tool_responsible(auth.uid(),keys.key::bigint)
    )) THEN RAISE EXCEPTION 'Unauthorized: cannot modify licenses' USING ERRCODE='42501'; END IF;
  IF NEW.projects IS DISTINCT FROM OLD.projects THEN
    RAISE EXCEPTION 'Unauthorized: cannot modify projects' USING ERRCODE = '42501';
  END IF;

  NEW.updated_at := timezone('utc'::text, now());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.enforce_booking_rules() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor uuid:=auth.uid(); admin boolean; manager boolean; level text; profile public.profiles; tool public.tools;
BEGIN
 IF actor IS NULL THEN
  IF current_setting('role',true) IN ('anon','authenticated') THEN RAISE EXCEPTION 'Authenticated identity required' USING ERRCODE='42501'; END IF;
  RETURN NEW;
 END IF;
 admin:=public.is_admin(actor);
 IF NOT public.is_approved_user(actor) THEN RAISE EXCEPTION 'Approved account required' USING ERRCODE='42501'; END IF;
 manager:=admin OR public.is_tool_responsible(actor,NEW.tool_id);
 IF TG_OP='UPDATE' AND (NEW.user_id<>OLD.user_id OR NEW.tool_id<>OLD.tool_id) THEN RAISE EXCEPTION 'Booking owner and tool are immutable' USING ERRCODE='42501'; END IF;
 IF NEW.user_id<>actor AND NOT manager THEN RAISE EXCEPTION 'Not booking owner' USING ERRCODE='42501'; END IF;
 SELECT * INTO STRICT profile FROM public.profiles WHERE id=NEW.user_id;
 SELECT * INTO STRICT tool FROM public.tools WHERE id=NEW.tool_id;
 IF NOT admin AND tool.status<>'up' THEN RAISE EXCEPTION 'Tool is unavailable' USING ERRCODE='22023'; END IF;
 IF NOT profile.is_approved AND NOT admin THEN RAISE EXCEPTION 'Booking owner is not approved' USING ERRCODE='42501'; END IF;
 level:=public.get_tool_access_level(profile.licenses,NEW.tool_id);
 IF NOT admin AND tool.license_req AND level IN ('none','level_1') THEN RAISE EXCEPTION 'User lacks required booking license' USING ERRCODE='42501'; END IF;
 IF NOT admin AND cardinality(profile.projects)>0 AND NOT NEW.project=ANY(profile.projects) THEN RAISE EXCEPTION 'Unassigned project' USING ERRCODE='42501'; END IF;
 IF TG_OP='INSERT' THEN
  IF NOT admin AND NEW.starts_at<now()-interval '5 minutes' THEN RAISE EXCEPTION 'Cannot book in the past' USING ERRCODE='22023'; END IF;
  NEW.status:=CASE WHEN tool.license_req AND level='level_2' AND NOT admin THEN 'pending_approval' ELSE 'confirmed' END;
  NEW.confirmed_by:=NULL; NEW.confirmed_at:=NULL;
 ELSE
  IF NOT admin AND OLD.ends_at<=now() THEN RAISE EXCEPTION 'Cannot modify ended booking' USING ERRCODE='42501'; END IF;
  IF NOT admin AND OLD.starts_at<=now() THEN
   IF NEW.starts_at<>OLD.starts_at THEN RAISE EXCEPTION 'Cannot alter start time of ongoing booking' USING ERRCODE='42501'; END IF;
   IF NEW.ends_at<=now() THEN RAISE EXCEPTION 'Cannot end ongoing booking in the past' USING ERRCODE='22023'; END IF;
  ELSIF NOT admin AND NEW.starts_at<now()-interval '5 minutes' THEN RAISE EXCEPTION 'Cannot move booking into past' USING ERRCODE='22023'; END IF;
  IF NOT manager AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.confirmed_by IS DISTINCT FROM OLD.confirmed_by OR NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at) THEN RAISE EXCEPTION 'Only tool managers can review bookings' USING ERRCODE='42501'; END IF;
  IF NEW.starts_at<>OLD.starts_at OR NEW.ends_at<>OLD.ends_at OR NEW.project<>OLD.project THEN
   IF tool.license_req AND level='level_2' AND NOT manager THEN NEW.status:='pending_approval';NEW.confirmed_by:=NULL;NEW.confirmed_at:=NULL; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.enforce_booking_delete_rules()
RETURNS trigger AS $$
DECLARE
  v_caller_id uuid;
BEGIN
  IF auth.uid() IS NULL AND current_setting('role',true) IN ('anon','authenticated') THEN
    RAISE EXCEPTION 'Authenticated identity required' USING ERRCODE='42501';
  END IF;
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL OR public.is_admin(v_caller_id) THEN
    RETURN OLD;
  END IF;

  IF NOT public.is_approved_user(v_caller_id) THEN
    RAISE EXCEPTION 'Approved account required' USING ERRCODE='42501';
  END IF;

  IF OLD.user_id <> v_caller_id AND NOT public.is_tool_responsible(v_caller_id,OLD.tool_id) THEN
    RAISE EXCEPTION 'Unauthorized: cannot delete another user booking' USING ERRCODE = '42501';
  END IF;

  IF OLD.starts_at <= now() THEN
    RAISE EXCEPTION 'Cannot cancel a booking after its start' USING ERRCODE = '42501';
  END IF;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Normalize legacy arrays to the live graded access format without flattening object licenses.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.profiles WHERE licenses IS NULL OR jsonb_typeof(licenses) NOT IN ('array','object')) THEN RAISE EXCEPTION 'Invalid license format'; END IF;
 IF EXISTS(SELECT 1 FROM public.profiles p CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(p.licenses)='array' THEN p.licenses ELSE '[]' END) x WHERE (x #>> '{}') !~ '^[0-9]+$' OR NOT EXISTS(SELECT 1 FROM public.tools WHERE id::text=x #>> '{}')) THEN RAISE EXCEPTION 'Invalid legacy license references'; END IF;
 IF EXISTS(SELECT 1 FROM public.profiles p CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(p.licenses)='object' THEN p.licenses ELSE '{}' END) x WHERE x.value NOT IN ('"level_1"'::jsonb,'"level_2"'::jsonb,'"level_3"'::jsonb)) THEN RAISE EXCEPTION 'Invalid graded license references'; END IF;
END $$;
UPDATE public.profiles p SET licenses=COALESCE((SELECT jsonb_object_agg(x #>> '{}','level_3') FROM jsonb_array_elements(p.licenses) x),'{}') WHERE jsonb_typeof(p.licenses)='array';
ALTER TABLE public.profiles ALTER COLUMN licenses SET DEFAULT '{}'::jsonb;
CREATE TABLE public.legacy_license_references (
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 tool_key text NOT NULL,
 access_level text NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,tool_key)
);
ALTER TABLE public.legacy_license_references ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.legacy_license_references FROM PUBLIC,anon,authenticated;
INSERT INTO public.legacy_license_references(user_id,tool_key,access_level)
 SELECT p.id,x.key,x.value #>> '{}' FROM public.profiles p CROSS JOIN LATERAL jsonb_each(p.licenses) x WHERE NOT EXISTS(SELECT 1 FROM public.tools WHERE id::text=x.key);
CREATE FUNCTION public.validate_profile_contract() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF jsonb_typeof(NEW.licenses)<>'object' OR EXISTS(SELECT 1 FROM jsonb_each(NEW.licenses) x WHERE x.value NOT IN ('"level_1"'::jsonb,'"level_2"'::jsonb,'"level_3"'::jsonb) OR (NOT EXISTS(SELECT 1 FROM public.tools WHERE id::text=x.key) AND (TG_OP='INSERT' OR OLD.licenses->x.key IS DISTINCT FROM x.value))) THEN
 RAISE EXCEPTION 'Licenses must map existing tool IDs to level_1, level_2 or level_3' USING ERRCODE='22023'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER validate_profile_contract BEFORE INSERT OR UPDATE OF licenses ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.validate_profile_contract();

-- Reject local times that have zero or multiple UTC mappings on DST transition days.
CREATE FUNCTION public.lab_instant(p_date date,p_time time) RETURNS timestamptz LANGUAGE plpgsql STABLE SET search_path=public AS $$
DECLARE wall timestamp := p_date+p_time; candidate timestamptz; matches integer;
BEGIN
 candidate:=wall AT TIME ZONE 'Europe/Vilnius';
 SELECT count(*) INTO matches FROM generate_series(candidate-interval '2 hours',candidate+interval '2 hours',interval '1 hour') x WHERE x AT TIME ZONE 'Europe/Vilnius'=wall;
 IF matches<>1 THEN RAISE EXCEPTION 'Nonexistent or ambiguous lab time' USING ERRCODE='22023'; END IF;
 RETURN candidate;
END $$;
CREATE FUNCTION public.sync_booking_contract() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF TG_OP='INSERT' OR NEW.date IS DISTINCT FROM OLD.date OR NEW.time IS DISTINCT FROM OLD.time THEN
 NEW.starts_at:=public.lab_instant(NEW.date,NEW.time);
 ELSIF NEW.starts_at IS DISTINCT FROM OLD.starts_at THEN
 RAISE EXCEPTION 'Change local date/time instead of starts_at' USING ERRCODE='22023'; END IF;
 IF TG_OP='INSERT' OR NEW.date IS DISTINCT FROM OLD.date OR NEW.time IS DISTINCT FROM OLD.time OR NEW.end_time IS DISTINCT FROM OLD.end_time THEN
 NEW.ends_at:=public.lab_instant(NEW.date+CASE WHEN NEW.end_time<=NEW.time THEN 1 ELSE 0 END,NEW.end_time);
 ELSIF NEW.ends_at IS DISTINCT FROM OLD.ends_at THEN
 RAISE EXCEPTION 'Change local end_time instead of ends_at' USING ERRCODE='22023'; END IF;
 SELECT name INTO NEW.tool_name FROM public.tools WHERE id=NEW.tool_id;
 SELECT trim(concat_ws(' ',first_name,last_name)) INTO NEW.user_name FROM public.profiles WHERE id=NEW.user_id;
 NEW.user_name:=COALESCE(NULLIF(NEW.user_name,''),'Lab member');
 IF TG_OP='INSERT' THEN NEW.created_at:=now(); ELSE NEW.created_at:=OLD.created_at; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER a_sync_booking_contract BEFORE INSERT OR UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.sync_booking_contract();

CREATE FUNCTION public.create_bookings(p_ranges jsonb) RETURNS SETOF public.bookings LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE item jsonb;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p_ranges)<>'array' OR jsonb_array_length(p_ranges) NOT BETWEEN 1 AND 336 THEN RAISE EXCEPTION 'Invalid ranges' USING ERRCODE='22023'; END IF;
 FOR item IN SELECT * FROM jsonb_array_elements(p_ranges) LOOP
 RETURN QUERY INSERT INTO public.bookings(tool_id,user_id,tool_name,user_name,project,date,time,end_time)
 VALUES((item->>'tool_id')::bigint,auth.uid(),'','',item->>'project',(item->>'date')::date,(item->>'time')::time,(item->>'end_time')::time) RETURNING *;
 END LOOP;
END $$;
-- Remove the obsolete signature to avoid PostgREST overload ambiguity.
DROP FUNCTION IF EXISTS public.update_booking_group(bigint[],bigint,date,time,time,text,text,text);
DROP FUNCTION IF EXISTS public.update_booking_group(bigint[],date,time,time,text);
CREATE FUNCTION public.update_booking_group(p_old_ids bigint[],p_date date,p_start_time time,p_end_time time,p_project text) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE b public.bookings; result public.bookings; n integer;
BEGIN
 IF cardinality(p_old_ids) IS NULL OR cardinality(p_old_ids)=0 OR cardinality(p_old_ids)<>(SELECT count(DISTINCT x) FROM unnest(p_old_ids) x) THEN RAISE EXCEPTION 'Invalid booking IDs' USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM public.bookings WHERE id=ANY(p_old_ids) ORDER BY id FOR UPDATE;
 SELECT count(*) INTO n FROM public.bookings WHERE id=ANY(p_old_ids);
 IF n<>cardinality(p_old_ids) THEN RAISE EXCEPTION 'Booking unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO b FROM public.bookings WHERE id=p_old_ids[1];
 IF EXISTS(SELECT 1 FROM public.bookings WHERE id=ANY(p_old_ids) AND (user_id<>b.user_id OR tool_id<>b.tool_id)) THEN RAISE EXCEPTION 'Mixed booking group' USING ERRCODE='22023'; END IF;
 IF b.user_id<>auth.uid() AND NOT public.is_admin(auth.uid()) AND NOT public.is_tool_responsible(auth.uid(),b.tool_id) THEN RAISE EXCEPTION 'Not owner' USING ERRCODE='42501'; END IF;
 DELETE FROM public.bookings WHERE id=ANY(p_old_ids) AND id<>b.id;
 UPDATE public.bookings SET date=p_date,time=p_start_time,end_time=p_end_time,project=p_project WHERE id=b.id RETURNING * INTO result;
 IF NOT FOUND THEN RAISE EXCEPTION 'Booking update denied' USING ERRCODE='42501'; END IF;
 RETURN to_jsonb(result);
END $$;
CREATE FUNCTION public.cancel_booking_group(p_ids bigint[],p_notify_users boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE b public.bookings; ids bigint[]:='{}'; events uuid[]:='{}'; result jsonb;
BEGIN
 IF cardinality(p_ids) IS NULL OR cardinality(p_ids)=0 OR cardinality(p_ids)<>(SELECT count(DISTINCT x) FROM unnest(p_ids) x) THEN RAISE EXCEPTION 'Invalid booking IDs' USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM public.bookings WHERE id=ANY(p_ids) ORDER BY id FOR UPDATE;
 IF (SELECT count(*) FROM public.bookings WHERE id=ANY(p_ids))<>cardinality(p_ids) THEN RAISE EXCEPTION 'Booking unavailable' USING ERRCODE='42501'; END IF;
 FOR b IN SELECT * FROM public.bookings WHERE id=ANY(p_ids) ORDER BY id LOOP
 result:=public.cancel_booking(b.id,p_notify_users);
 ids:=array_append(ids,b.id);
 IF result->>'cancellation_event_id' IS NOT NULL THEN events:=array_append(events,(result->>'cancellation_event_id')::uuid); END IF;
 END LOOP;
 RETURN jsonb_build_object('cancelled_ids',ids,'event_ids',events);
END $$;
-- Revoke existing feeds when approval is withdrawn.
CREATE FUNCTION public.revoke_unapproved_calendar() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN IF NOT NEW.is_approved THEN DELETE FROM public.user_calendar_tokens WHERE user_id=NEW.id; END IF; RETURN NEW; END $$;
CREATE TRIGGER revoke_unapproved_calendar AFTER UPDATE OF is_approved ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.revoke_unapproved_calendar();
CREATE FUNCTION public.edit_profile_assignment(p_user_id uuid,p_kind text,p_value text,p_add boolean) RETURNS public.profiles LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE p public.profiles;
BEGIN
 IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'Admin required' USING ERRCODE='42501'; END IF;
 SELECT * INTO STRICT p FROM public.profiles WHERE id=p_user_id FOR UPDATE;
 IF p_kind='license' THEN
 IF p_add THEN p.licenses:=p.licenses || jsonb_build_object(p_value,'level_3'); ELSE p.licenses:=p.licenses-p_value; END IF;
 ELSIF p_kind='project' AND length(trim(p_value)) BETWEEN 1 AND 100 THEN
 IF p_add THEN p.projects:=ARRAY(SELECT DISTINCT unnest(p.projects||ARRAY[trim(p_value)])); ELSE p.projects:=array_remove(p.projects,p_value); END IF;
 ELSE RAISE EXCEPTION 'Invalid assignment' USING ERRCODE='22023'; END IF;
 UPDATE public.profiles SET licenses=p.licenses,projects=p.projects WHERE id=p_user_id RETURNING * INTO p;
 RETURN p;
END $$;
REVOKE ALL ON FUNCTION public.create_bookings(jsonb),public.update_booking_group(bigint[],date,time,time,text),public.cancel_booking_group(bigint[],boolean),public.edit_profile_assignment(uuid,text,text,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_bookings(jsonb),public.update_booking_group(bigint[],date,time,time,text),public.cancel_booking_group(bigint[],boolean),public.edit_profile_assignment(uuid,text,text,boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.sync_booking_contract(),public.validate_profile_contract(),public.revoke_unapproved_calendar(),public.enforce_profile_update_rules(),public.enforce_booking_rules(),public.enforce_booking_delete_rules() FROM PUBLIC,anon,authenticated;

DROP TRIGGER IF EXISTS trg_enforce_profile_update_rules ON public.profiles;
DROP TRIGGER IF EXISTS prevent_double_booking ON public.bookings;
DROP FUNCTION IF EXISTS public.check_double_booking();
DROP FUNCTION IF EXISTS public.validate_and_set_booking_range();
ALTER FUNCTION public.get_tool_access_level(jsonb,bigint) SET search_path=public;
-- Lock the target profile before computing a new license map, avoiding lost admin changes.
CREATE OR REPLACE FUNCTION public.set_user_tool_license(p_user_id uuid,p_tool_id bigint,p_level text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_licenses jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_approved_user(auth.uid()) OR NOT (public.is_admin(auth.uid()) OR public.is_tool_responsible(auth.uid(),p_tool_id)) THEN RAISE EXCEPTION 'Tool manager required' USING ERRCODE='42501'; END IF;
 IF p_level IS NULL OR p_level NOT IN ('none','level_1','level_2','level_3') THEN RAISE EXCEPTION 'Invalid access level' USING ERRCODE='22023'; END IF;
 SELECT p.licenses INTO STRICT v_licenses FROM public.profiles p WHERE id=p_user_id FOR UPDATE;
 IF p_level='none' THEN v_licenses:=v_licenses-p_tool_id::text; ELSE v_licenses:=jsonb_set(v_licenses,ARRAY[p_tool_id::text],to_jsonb(p_level)); END IF;
 UPDATE public.profiles SET licenses=v_licenses WHERE id=p_user_id;
 RETURN jsonb_build_object('licenses',v_licenses);
END $$;

CREATE OR REPLACE FUNCTION public.confirm_booking(p_booking_id bigint) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE b public.bookings;
BEGIN
 SELECT * INTO STRICT b FROM public.bookings WHERE id=p_booking_id FOR UPDATE;
 IF auth.uid() IS NULL OR NOT public.is_approved_user(auth.uid()) OR NOT (public.is_admin(auth.uid()) OR public.is_tool_responsible(auth.uid(),b.tool_id)) THEN RAISE EXCEPTION 'Tool manager required' USING ERRCODE='42501'; END IF;
 IF b.status<>'pending_approval' THEN RAISE EXCEPTION 'Booking is not pending' USING ERRCODE='22023'; END IF;
 UPDATE public.bookings SET status='confirmed',confirmed_by=auth.uid(),confirmed_at=now() WHERE id=b.id;
 RETURN jsonb_build_object('success',true,'booking_id',b.id,'status','confirmed');
END $$;
CREATE OR REPLACE FUNCTION public.reject_booking(p_booking_id bigint,p_reason text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE b public.bookings;
BEGIN
 SELECT * INTO STRICT b FROM public.bookings WHERE id=p_booking_id FOR UPDATE;
 IF auth.uid() IS NULL OR NOT public.is_approved_user(auth.uid()) OR NOT (public.is_admin(auth.uid()) OR public.is_tool_responsible(auth.uid(),b.tool_id)) THEN RAISE EXCEPTION 'Tool manager required' USING ERRCODE='42501'; END IF;
 IF b.status<>'pending_approval' THEN RAISE EXCEPTION 'Booking is not pending' USING ERRCODE='22023'; END IF;
 DELETE FROM public.bookings WHERE id=b.id;
 RETURN jsonb_build_object('success',true,'booking_id',b.id,'status','rejected','reason',left(p_reason,500));
END $$;
CREATE OR REPLACE FUNCTION public.approve_training_request(p_request_id bigint,p_notes text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.training_requests;
BEGIN
 SELECT * INTO STRICT r FROM public.training_requests WHERE id=p_request_id FOR UPDATE;
 IF auth.uid() IS NULL OR NOT public.is_approved_user(auth.uid()) OR NOT (public.is_admin(auth.uid()) OR public.is_tool_responsible(auth.uid(),r.tool_id)) THEN RAISE EXCEPTION 'Tool manager required' USING ERRCODE='42501'; END IF;
 IF r.status<>'pending' THEN RAISE EXCEPTION 'Request already reviewed' USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM public.profiles WHERE id=r.user_id FOR UPDATE;
 -- Do not downgrade an existing supervised or independent license on training approval.
 UPDATE public.profiles SET licenses=licenses || jsonb_build_object(r.tool_id::text,'level_1') WHERE id=r.user_id AND NOT licenses ? r.tool_id::text;
 UPDATE public.training_requests SET status='approved',reviewed_by=auth.uid(),reviewed_at=now(),notes=left(p_notes,2000) WHERE id=r.id;
 RETURN jsonb_build_object('success',true,'request_id',r.id);
END $$;
CREATE OR REPLACE FUNCTION public.reject_training_request(p_request_id bigint,p_notes text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.training_requests;
BEGIN
 SELECT * INTO STRICT r FROM public.training_requests WHERE id=p_request_id FOR UPDATE;
 IF auth.uid() IS NULL OR NOT public.is_approved_user(auth.uid()) OR NOT (public.is_admin(auth.uid()) OR public.is_tool_responsible(auth.uid(),r.tool_id)) THEN RAISE EXCEPTION 'Tool manager required' USING ERRCODE='42501'; END IF;
 IF r.status<>'pending' THEN RAISE EXCEPTION 'Request already reviewed' USING ERRCODE='22023'; END IF;
 UPDATE public.training_requests SET status='rejected',reviewed_by=auth.uid(),reviewed_at=now(),notes=left(p_notes,2000) WHERE id=r.id;
 RETURN jsonb_build_object('success',true,'request_id',r.id);
END $$;
CREATE FUNCTION public.training_request_contract() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF auth.uid() IS NULL OR NOT public.is_approved_user(auth.uid()) OR NEW.user_id<>auth.uid() THEN RAISE EXCEPTION 'Approved owner required' USING ERRCODE='42501'; END IF;
  IF length(trim(NEW.description)) NOT BETWEEN 1 AND 3000 OR NEW.preferred_date<(now() AT TIME ZONE 'Europe/Vilnius')::date THEN RAISE EXCEPTION 'Invalid training request' USING ERRCODE='22023'; END IF;
  NEW.status:='pending';NEW.reviewed_by:=NULL;NEW.reviewed_at:=NULL;NEW.notes:=NULL;NEW.created_at:=now();
  SELECT name INTO STRICT NEW.tool_name FROM public.tools WHERE id=NEW.tool_id;
  SELECT trim(concat_ws(' ',first_name,last_name)),email INTO NEW.user_name,NEW.user_email FROM public.profiles WHERE id=NEW.user_id;
 ELSE
  IF NEW.user_id<>OLD.user_id OR NEW.tool_id<>OLD.tool_id THEN RAISE EXCEPTION 'Request identity is immutable' USING ERRCODE='42501'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER training_request_contract BEFORE INSERT OR UPDATE ON public.training_requests FOR EACH ROW EXECUTE FUNCTION public.training_request_contract();
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='training_requests' LOOP EXECUTE format('DROP POLICY %I ON public.training_requests',r.policyname); END LOOP;
END $$;
REVOKE ALL ON public.training_requests FROM anon,authenticated;
GRANT SELECT,INSERT ON public.training_requests TO authenticated;
CREATE POLICY training_read ON public.training_requests FOR SELECT TO authenticated USING(public.is_approved_user(auth.uid()) AND (user_id=auth.uid() OR public.is_admin(auth.uid()) OR public.is_tool_responsible(auth.uid(),tool_id)));
CREATE POLICY training_insert ON public.training_requests FOR INSERT TO authenticated WITH CHECK(public.is_approved_user(auth.uid()) AND user_id=auth.uid());
GRANT SELECT ON public.cancellation_events TO authenticated;
-- Explicit grants override Supabase default privileges, including old anon EXECUTE grants.
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT p.oid::regprocedure AS signature FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.prosecdef LOOP
 EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC,anon',r.signature);
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.training_request_contract() FROM PUBLIC,anon,authenticated;
NOTIFY pgrst,'reload schema';

CREATE SCHEMA IF NOT EXISTS extensions;
ALTER EXTENSION btree_gist SET SCHEMA extensions;
