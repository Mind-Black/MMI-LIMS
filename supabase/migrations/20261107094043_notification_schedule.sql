-- Hosted scheduling uses existing free-tier extensions; local runners without these extensions skip it.
DO $migration$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_available_extensions WHERE name='pg_cron') OR to_regnamespace('vault') IS NULL THEN RETURN; END IF;
 CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
 CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
 IF NOT EXISTS(SELECT 1 FROM vault.decrypted_secrets WHERE name='mmi_notification_worker_secret') THEN RAISE EXCEPTION 'Configure worker Vault secret before enabling schedule'; END IF;
 PERFORM cron.schedule('mmi-notification-worker','* * * * *',$job$
 SELECT net.http_post(
  url := 'https://zopwfborahwrerymgrqz.supabase.co/functions/v1/notification-worker',
  headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='mmi_notification_worker_secret')),
  body := '{}'::jsonb,
  timeout_milliseconds := 90000
 );
 $job$);
END $migration$;
