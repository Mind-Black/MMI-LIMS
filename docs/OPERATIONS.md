# MMI-LIMS production operations

## Release baseline and data preservation

This release builds on origin/main 53e55008, which already includes infrastructure management, three access levels, training applications, booking confirmation, and rate categories. Those workflows remain supported. The earlier checkout was stale; do not deploy the legacy hardening branch.

The 2026-11-07 release snapshot contains 5 profiles, 76 tools, 117 bookings and no training requests. It excludes passwords, sessions, identities and calendar bearer tokens. It is encrypted with AES-256-GCM and its random encryption key is protected with the current Windows account's DPAPI. The ignored .release-secrets/pre-release.encrypted.json file is never committed. `node scripts/restore-drill.mjs` decrypts into memory, restores into isolated PGlite, applies the forward migrations and checks record counts, license maps and every booking interval. The restore drill succeeded before production deployment. This snapshot protects the business data being migrated; it is not an Auth credential backup.

Deleted-equipment license entries are preserved unchanged and recorded in the private legacy_license_references table. New grants to missing tools are rejected. Do not reuse deleted equipment IDs. Review orphaned entries with the lab owner before explicitly removing them.

## Authorization and booking contracts

Signup creates an unapproved ordinary profile; metadata cannot grant privileges. Bootstrap the first admin with privileged SQL. Only approved identities may book; owners/admins and designated responsible staff manage their permitted bookings. Level I cannot book, Level II holds a slot pending confirmation, Level III books directly. Only administrators or responsible staff can confirm/reject. Training approval starts an unlicensed user at Level I and never downgrades existing access. License and project changes lock profiles to prevent lost updates. Training and booking review lock the reviewed record and reject repeat review.

Ordinary users cannot cancel a reservation after its start, change an ongoing start, or modify ended bookings. Ongoing end changes must remain after now. Group creation/cancellation are transactional; updates retain the primary booking ID and creation time. Database triggers derive labels and canonical UTC intervals. Europe/Vilnius is authoritative; newly supplied ambiguous or nonexistent local times are rejected. Existing valid instants are preserved. Data API grants and policies explicitly reject anonymous access and missing user identities.

Frontend booking operations live in src/services/bookings.ts. `npm run types:generate` derives interfaces from the entire migration chain; `npm run typecheck` rejects stale argument contracts. The actual ICS serializer is shared between tests and the server.

## Configuration and release checks

Browser: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, optional VITE_BASE_PATH. Server: platform Supabase keys, RESEND_API_KEY, NOTIFICATION_WORKER_SECRET, optional EMAIL_FROM and SITE_URL. Verify EMAIL_FROM with the provider. Keep service keys server-side. Configure Auth recovery redirects for the deployed Pages URL. Never log calendar URLs or tokens.

Run `npm ci`, `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`, `npm run test:browser`, and `deno check supabase/functions/*/index.ts`. GitHub PR checks include real PostgreSQL 17 migration/workflow checks. Browser regression tests use mocked API responses; release smoke checks additionally exercise the deployed Auth, REST API, functions and Pages build.

Before each release, save the read-only supabase/preflight.sql output and an encrypted approved snapshot. Rehearse the upgrade locally. Deploy production_contracts and notification_queue, deploy the Edge Functions, then notification_schedule and the matching frontend. The booking update signature remains compatible with the latest production interface. Confirm no unexpected migration versions or concurrent upstream commits appeared before merging.

## Notification delivery and monitoring

The notification scheduler uses pg_cron and pg_net on the existing project, without paid branching or PITR. Its one-minute POST reads mmi_notification_worker_secret from Vault. The Edge worker requires the matching NOTIFICATION_WORKER_SECRET. Rotate both together. notify-cancellation requires a committed event ID and reports queued/completed status; it cannot fabricate broadcasts.

Each cancellation transaction captures its approved licensed-recipient audience, excluding the cancelling user. Jobs use atomic five-minute leases, five deliveries per invocation, stable provider idempotency keys, exponential retry, and failed status after eight failures. The event is complete only after all recipients succeed. Expired worker leases are reclaimed. Provider idempotency retention does not guarantee exactly-once external delivery.

Inspect supabase/monitoring.sql after release: worker scheduler failures, overdue queue age, failed/partial deliveries, authorization failures, booking command errors and feed errors. Fix provider/configuration failures before requeuing failed jobs. Email quotas reserve attempts atomically before dispatch and count failed attempts as well as successes. Calendar feeds paginate the full horizon and recheck account approval; revocation deletes bearer tokens.

## Recovery

Stop frontend writes and the worker before emergency recovery. Prefer a corrective forward migration, retaining queue records and provider IDs. Restoring a data snapshot requires an explicit decision about newer writes; do not restore old data to undo a frontend-only defect. Revoke affected tokens and secrets after suspected disclosure. No paid backup, branch, or PITR feature is required by this release.
