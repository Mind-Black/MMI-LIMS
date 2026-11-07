-- Alert if failed > 0, oldest ready backlog exceeds 10 minutes, or processing leases expire.
SELECT status,count(*),min(available_at) AS oldest_due FROM notification_deliveries GROUP BY status;
SELECT count(*) AS incomplete_events FROM cancellation_events WHERE NOT notified AND created_at<now()-interval '10 minutes';
-- Requeue failed jobs only after resolving the provider/configuration error.
-- UPDATE notification_deliveries SET status='pending',attempts=0,available_at=now() WHERE status='failed';
