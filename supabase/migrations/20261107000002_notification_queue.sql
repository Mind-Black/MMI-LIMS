-- Durable delivery queue. Service-only functions are used by the scheduled worker.
ALTER TABLE public.email_logs ALTER COLUMN created_at SET DEFAULT now();
CREATE TABLE public.notification_deliveries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 event_id uuid NOT NULL REFERENCES public.cancellation_events(id) ON DELETE CASCADE,
 recipient_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 email text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','sent','failed')),
 attempts integer NOT NULL DEFAULT 0,
 available_at timestamptz NOT NULL DEFAULT now(),
 lease uuid,
 last_error text,
 sent_at timestamptz,
 UNIQUE(event_id,recipient_id)
);
ALTER TABLE public.notification_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_deliveries FROM anon,authenticated;
CREATE INDEX notification_ready ON public.notification_deliveries(available_at) WHERE status IN ('pending','processing');
CREATE FUNCTION public.queue_cancellation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF auth.uid() IS NOT NULL THEN PERFORM public.reserve_email_quota(NEW.booking_id); END IF;
 INSERT INTO public.notification_deliveries(event_id,recipient_id,email)
 SELECT NEW.id,p.id,u.email FROM public.profiles p JOIN auth.users u ON u.id=p.id
 WHERE p.is_approved AND p.id<>NEW.cancelled_by AND p.licenses ? NEW.tool_id::text AND u.email IS NOT NULL;
 IF NOT FOUND THEN UPDATE public.cancellation_events SET notified=true,notified_at=now() WHERE id=NEW.id; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER queue_cancellation AFTER INSERT ON public.cancellation_events FOR EACH ROW EXECUTE FUNCTION public.queue_cancellation();
-- Recover unsent historical committed events without recreating already delivered events.
INSERT INTO public.notification_deliveries(event_id,recipient_id,email)
SELECT e.id,p.id,u.email FROM public.cancellation_events e JOIN public.profiles p ON p.licenses ? e.tool_id::text JOIN auth.users u ON u.id=p.id
WHERE NOT e.notified AND p.is_approved AND p.id<>e.cancelled_by AND u.email IS NOT NULL ON CONFLICT DO NOTHING;
CREATE FUNCTION public.claim_notifications() RETURNS SETOF public.notification_deliveries LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 UPDATE public.notification_deliveries SET status='processing',lease=gen_random_uuid(),attempts=attempts+1,available_at=now()+interval '5 minutes'
 WHERE id IN (SELECT id FROM public.notification_deliveries WHERE status IN ('pending','processing') AND available_at<=now() ORDER BY available_at,id LIMIT 5 FOR UPDATE SKIP LOCKED) RETURNING *;
$$;
CREATE FUNCTION public.finish_notification(p_id uuid,p_lease uuid,p_error text DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE event uuid;
BEGIN
 UPDATE public.notification_deliveries SET status=CASE WHEN p_error IS NULL THEN 'sent' WHEN attempts>=8 THEN 'failed' ELSE 'pending' END,
 last_error=left(p_error,500),sent_at=CASE WHEN p_error IS NULL THEN now() END,available_at=now()+interval '1 minute'*power(2,LEAST(attempts,8)),lease=NULL
 WHERE id=p_id AND lease=p_lease AND status='processing' RETURNING event_id INTO event;
 IF event IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.notification_deliveries WHERE event_id=event AND status<>'sent') THEN
 UPDATE public.cancellation_events SET notified=true,notified_at=now() WHERE id=event;
 END IF;
END $$;
CREATE FUNCTION public.reserve_email_quota(p_booking_id bigint) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE reservation uuid;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_approved_user(auth.uid()) THEN RAISE EXCEPTION 'Approved account required' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 IF NOT public.is_admin(auth.uid()) AND (SELECT count(*) FROM public.email_logs WHERE sender_id=auth.uid() AND created_at>now()-interval '1 hour')>=20 THEN RAISE EXCEPTION 'Email quota exceeded' USING ERRCODE='P0001'; END IF;
 INSERT INTO public.email_logs(sender_id,recipient_email,booking_id) VALUES(auth.uid(),'reserved',p_booking_id) RETURNING id INTO reservation;
 RETURN reservation;
END $$;
REVOKE ALL ON FUNCTION public.queue_cancellation(),public.claim_notifications(),public.finish_notification(uuid,uuid,text),public.reserve_email_quota(bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_notifications(),public.finish_notification(uuid,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.reserve_email_quota(bigint) TO authenticated;
