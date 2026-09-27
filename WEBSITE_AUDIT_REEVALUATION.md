# Audit reevaluation: fix/audit-findings

Reviewed 2026-09-27. Branch `fix/audit-findings`, commit `ae2a5cf`, compared with `main` at `bacd031` and `WEBSITE_AUDIT_AND_FIX_PLAN.md`.

**Verdict: substantial improvements, but not ready to merge/deploy as a completed security remediation.** The new group-update RPC permits deletion of another user's bookings. Fresh installation and an upgrade from a representative older schema both fail. Several original requirements remain partially implemented despite passing frontend checks.

## Verification results

| Check | Result |
| --- | --- |
| Locked install | `npm ci --ignore-scripts --no-audit --no-fund` passed; project dependency files unchanged by this review. |
| Lint | `npm run lint` passed, versus 21 errors and 5 warnings previously. |
| Tests | `npm test` passed: 10 Node tests plus the booking assertion script. |
| Build | `npm run build` passed with Vite 7.3.6 after resolving sandbox filesystem restrictions. Main JS: 446.74 kB / 127.25 kB gzip. Admin chunk: 7.82 kB / 2.32 kB gzip. |
| npm advisories | `npm audit --json` returned **0** affected packages, versus 15 previously. This does not audit the separately resolved Deno/Edge dependencies. |
| PostgreSQL reproductions | Confirmed cross-owner deletion through RPC, broken migration paths, missing `updated_at` on an older profile schema, pending-user data reads, acceptance of unassigned projects, and modification of historical bookings. Also verified that ordinary direct cross-owner DELETE, self-promotion, and overlapping INSERT are rejected by the intended new schema. |
| Edge handler reproduction | The actual cancellation handler, executed with mocked Supabase/Auth/email services, sent two fake notifications for two identical invented cancellation requests. It never looked up a booking or cancellation event. No real emails were sent. |
| Timezone reproduction | The same stored booking was classified differently in Vilnius, UTC, and Los Angeles; opening a Monday booking in Los Angeles initialized the modal to the previous week. |

Database tests used isolated, in-memory PGlite PostgreSQL with `btree_gist` and `pgcrypto`, real SQL from the branch, minimal fixtures for `auth.users`, `auth.uid()` and `auth.role()`, and authenticated table/sequence grants representative of the Data API. The RPC tests intentionally installed the new schema independently of the broken historical migration order so its behavior could be evaluated. These tests are not a substitute for a full Supabase CLI reset/upgrade, two-session concurrency tests, or verification of deployed grants. No live database, browser session, or production mail provider was exercised. PostgreSQL/Supabase CLI, Docker, and Deno were not available on PATH during the review; Edge functions were not type-checked.

## Release blockers and high-priority findings

### R1 — P0: The atomic update RPC can delete other users' bookings

**Locations:** `supabase/migrations/20260927000001_security_and_constraints.sql:283-301`; same implementation in `20260927000000_baseline_schema.sql:291-311`.

`update_booking_group` checks ownership only for `p_old_ids[1]`. It then deletes every secondary ID without checking its owner, tool, date, project, or membership of the same reservation. The function runs as SECURITY DEFINER, so the ordinary DELETE policy does not protect those secondary rows when the function is owned by the migration role.

**Reproduced:** User A owned booking 1, user B owned booking 2. A's direct DELETE of booking 2 affected zero rows. A's call to `update_booking_group([1,2], ...)` succeeded, and booking 2 no longer existed afterward. A valid update to A's booking is enough to commit the unauthorized deletion. IDs are readily discoverable through the booking SELECT policy.

**Required fix:** Authenticate explicitly; lock and validate every distinct ID before any mutation; require an exact expected row count; require ownership/admin authority for every row and valid group membership. Prefer a server-owned reservation/group identifier rather than a client-supplied deletion list. Reject mixed-owner, mixed-tool, unrelated, missing, duplicate, and empty IDs atomically. Restrict the callable operation until repaired if this branch has already been deployed.

**Release test:** Two ordinary users, one booking each. Direct DELETE and mixed-owner RPC must both fail to delete the other user's row. Force the final update to fail and prove all original rows survive. The same regression test must cover both migration definitions or, preferably, eliminate duplicated definitions.

### R2 — P1: The migration sequence cannot initialize a fresh database or upgrade the old schema

**Locations:** `supabase/migrations/20231214_add_calendar_token.sql:2`; `20260927000000_baseline_schema.sql:63-86`; `20260927000001_security_and_constraints.sql:44-64`.

The 2023 migration executes before the new 2026 baseline and alters `profiles`, which does not exist on a fresh application database. In an existing installation, the baseline's `CREATE TABLE IF NOT EXISTS bookings` leaves the old table unchanged, then creates an index on `starts_at` before the following migration adds that column.

**Reproduced:** Fresh chronological first migration failed with `42P01: relation "profiles" does not exist`. Applying the baseline to a representative existing schema with bookings but no range columns failed with `42703: column "starts_at" does not exist`.

**Required fix:** Design and test a consistent migration history for both empty and previously deployed databases. Account for recorded historical migration versions rather than blindly renaming applied files. Add required columns/types before indexes, constraints, or routines use them. Do not rely on CREATE TABLE IF NOT EXISTS to upgrade a table. Document and automate the baseline/upgrade procedure.

**Release test:** Full `supabase db reset` from tracked files, plus upgrades from snapshots representing supported existing schema versions. Both must pass without manual skipping/reordering. Supabase applies migrations in timestamp order ([migration documentation](https://supabase.com/docs/guides/deployment/database-migrations)).

### R3 — P1: The forward-only upgrade can break all profile updates

**Locations:** `supabase/migrations/20260927000001_security_and_constraints.sql:120-150`; `20260927000000_baseline_schema.sql:36-46`.

The profile-update trigger unconditionally writes `NEW.updated_at`, but the forward migration never adds that column. Only the new-table declaration contains it. Existing profiles without this timestamp remain incompatible even if the baseline ordering issue is worked around.

**Reproduced:** The forward migration applied to an older profile schema, but an ordinary first-name UPDATE failed with `42703: record "new" has no field "updated_at"`. Admin updates take a branch that writes the same missing field, affecting approval, license, and project management too.

**Required fix/test:** Add and backfill required profile columns before attaching the trigger, audit all other old/new schema assumptions, and exercise self-service edits plus admin approval/license/project updates on upgraded data. Also document a controlled first-admin provisioning method: the new trigger rejects role changes made without an authenticated admin identity, including a simple SQL-editor promotion.

### R4 — P1: Cancellation notifications still accept invented events and unlimited replays

**Locations:** `supabase/functions/notify-cancellation/index.ts:67-98,137-153`; `supabase/functions/send-email/index.ts:75-101,170-178`.

Approval checks, trusted sender/tool names, recipient filtering, and bounded concurrency are improvements. However, the cancellation endpoint still accepts caller-supplied date/time and checks only that the tool exists. It does not require a committed cancellation, verify the actor's authority over it, or deduplicate it. Any approved account can repeatedly broadcast false availability. Booking messages now derive the recipient from a booking, but have no sender/recipient quotas or replay protection either.

**Reproduced:** Two identical fabricated cancellation requests to the actual handler, with approved-user/tool/recipient fixtures and a fake email provider, returned HTTP 200 and caused two sends. Queried tables were only `profiles`, `tools`, and `profiles`; no booking/cancellation verification occurred.

**Required fix/test:** Create an authorized cancellation event and outbox record in the cancellation transaction. Accept only that event identity, derive all message details, and deduplicate event-recipient delivery. Add bounded user/recipient quotas for booking messages. Fake-provider tests must reject invented, unauthorized, and replayed events and exercise provider throttling/retries.

### R5 — P1: Query windowing introduces missing availability and incomplete admin results

**Locations:** `src/components/Dashboard.jsx:70-92,169-189,748-760`; `src/components/BookingModal.jsx:30-37,443-463`; `supabase/functions/serve-ics/index.ts:132-146`.

The dashboard fetches bookings within -7/+14 days of its own week, OR any booking owned by the current user. This is not pagination: the personal-history arm is unbounded, and the entire response still has a 1,000-row cap. Sorting ascending can fill that response with old personal bookings and omit current availability. Admin filters operate only on this incomplete array and cannot retrieve another user's booking outside the window.

The modal has its own week state. Navigating forward/back there does not change the dashboard query window. Other users' reservations outside that window therefore disappear from the modal, even before the row cap is reached. A working database exclusion constraint prevents a conflicting save but cannot restore accurate availability, messaging, or administrative search.

The ICS feed and user directory also still use a single unpaged query; older entries can consume the entire feed response.

**Required fix/test:** Fetch modal availability by the modal's actual tool/week. Query admin filters server-side and page results separately from personal history. Use stable ordering with an ID tie-breaker, and page feeds or explicitly define a feed horizon. Seed over 1,000 personal/history records and book another user's tool several weeks away; verify all views show the expected data. Do not describe these queries as paginated in the README until pagination exists.

### R6 — P1: Lab timezone handling remains inconsistent

**Locations:** `src/utils/bookingUtils.js:49-66`; `src/components/BookingModal.jsx:31-36,168-176`; `src/hooks/useBookingInteraction.js:29-38,175-185`; `src/components/Dashboard.jsx:195-198,300-304,629-650`.

Using local components fixes the original UTC date-key shift, but “local” is still the browser timezone, not Europe/Vilnius. Displaying a lab-timezone label does not change Date parsing. The client ignores the new `starts_at`/`ends_at` instants for many past/active checks while the database interprets date/time in Vilnius.

**Reproduced:** Booking end `2026-09-28T10:00` is 07:00Z in Vilnius, 10:00Z in UTC, and 17:00Z in Los Angeles. At 08:00Z, the Vilnius browser marks it past while the other two do not. Separately, `new Date('2026-09-28')` is Sunday in Los Angeles; the modal's Monday calculation opens the week beginning September 21 instead of September 28.

**Required fix/test:** Treat date-only values as calendar dates without implicit UTC parsing; construct/display lab calendar dates explicitly and use authoritative instants for active/past comparisons. Run the same booking scenarios in three timezones and across midnight/DST. Assert the same reservation and permission outcome, not merely that a local Date formats back to its local date.

### R7 — P1: Server rules still permit unauthorized business actions

**Locations:** `supabase/migrations/20260927000001_security_and_constraints.sql:219-241,292-299`; `20260927000000_baseline_schema.sql:449-454`.

The new trigger checks approval, tool status, licensing, owner identity, and the proposed end time. It never checks assigned project membership or the original booking's time/state. An ordinary owner can move a historical booking into the future through the RPC, alter the start of an in-progress booking, or directly delete an active/past booking that the UI would disallow. Deletion has no equivalent business-rule trigger. Checking only the new end also permits retroactive starts.

**Reproduced:** An approved profile with `projects = []` inserted `UNASSIGNED_PROJECT`. A 2020 reservation owned by that user was moved to 2030 through the RPC. Both operations succeeded in the new schema.

**Required fix/test:** Define the policy for General bookings, assigned projects, current-slot creation, historical changes, active-booking shortening, and admin overrides. Enforce it for INSERT, UPDATE/RPC, and DELETE against locked original rows and server time. Preserve an audit record for authorized overrides. Add direct-API tests; UI checks alone are insufficient.

### R8 — P1: Pending accounts can still read all profiles and private booking details

**Locations:** `supabase/migrations/20260927000001_security_and_constraints.sql:374-380`; `src/components/DashboardWrapper.jsx:20-65`.

Anonymous access and public plaintext token storage are removed, but the SELECT policies allow every authenticated account, including pending/unapproved users, to read all profiles and bookings. These rows include names, projects, approval/role/license data, and owner IDs. The pending-approval UI is not an API access restriction. The wrapper also has no subscription or periodic authorization refresh after approval/revocation; stale admin/profile state can remain visible until remount/manual refresh.

**Reproduced:** A pending-user fixture selected all three profiles and both existing bookings using the authenticated role and the new policies.

**Required fix/test:** Restrict pending users to their own minimal account state. Separate approved-user availability/directory fields from private booking and authorization details. Restrict private fields to owner/admin access using protected tables or properly permissioned views. Refresh UI authorization when accounts change or are revoked. Test anonymous, pending, approved ordinary, revoked, and admin roles against direct queries.

## Remaining reliability and completeness issues

### R9 — P2: Zero-row cancellation/status changes still report success

**Locations:** `src/components/Dashboard.jsx:328-356,372-380`; `src/components/UserManagement.jsx:37-61,99-162`.

Create and most user-management mutations now check returned data and preserve failures better. However, cancellation/tool status still check only `error`, then change local state and report success even if no row was affected. A stale/RLS-filtered cancellation can also trigger a false notification from cached details. License/project mutations still replace whole arrays derived from stale state, losing concurrent changes.

**Fix/test:** Verify affected IDs/counts for cancellation/status, derive notifications from committed events, and use transactional add/remove or revision checks for entitlements and booking edits. Exercise stale IDs, permission revocation, network errors, and simultaneous administrators.

### R10 — P2: Background refresh can leave the dashboard stuck loading

**Location:** `src/components/Dashboard.jsx:65-67,97-118,124-138`.

If an initial fetch takes longer than the 15-second polling interval, a background fetch increments `querySeqRef`. The initial response/finally path is discarded. The background request does not clear loading because it has `isBackground = true`. All later polls are background requests, so the spinner can remain indefinitely. Requests still overlap, and an in-flight read can replace data after a mutation because mutations do not invalidate the read generation.

**Fix/test:** Prevent overlapping refreshes, tie loading to the latest authoritative request independent of foreground/background origin, and invalidate/cancel pre-mutation reads. Use controlled promises to test slow initial load, out-of-order responses, and a mutation during refresh.

### R11 — P2: Week navigation keeps invisible selected slots

**Location:** `src/components/BookingModal.jsx:443-463,487-530`.

Previous/Next/Today changes only the week; unlike the old implementation, it does not clear `selectedSlots`. Selecting a slot and navigating away leaves Confirm enabled and can reserve an off-screen date, or combine invisible prior selections with the new week's selection.

**Fix/test:** Clear selection on week changes or explicitly display a cross-week selection summary before confirmation. Test selecting, navigating, and confirming without further selection.

### R12 — P2: Copying a calendar link silently revokes existing subscriptions

**Location:** `src/components/Dashboard.jsx:399-420,560-568`.

Both the ordinary calendar action and the explicit reset action generate a new token and overwrite its hash. Only reset asks/warns about invalidating previous clients. Copying for a second calendar therefore breaks the first subscription; a clipboard failure after the database write also revokes the old link without delivering the new one.

**Fix/test:** Make token replacement explicit, provide recoverable display if copying fails, and either support individually revocable client tokens or clearly label every regeneration as replacement. Test two clients and clipboard denial. Separately, migrating an old plaintext token to its hash does not revoke a token that was already leaked; deployment review must determine whether old links need forced rotation.

### R13 — P2: Feed/notification edge cases remain and are not covered by integration tests

**Locations:** `supabase/functions/notify-cancellation/index.ts:98,112-117,164-168`; `supabase/functions/serve-ics/index.ts:21,176-191`; `supabase/migrations/20260927000001_security_and_constraints.sql:70-72`; `tests/icsSerializer.test.js:5-51`.

- Recipient `.limit(100)` silently drops everyone beyond the first 100 instead of queueing subsequent pages. Auth email lookups run serially; there is no durable retry/outbox. The UI calls zero successful sends “no eligible users” even when the function returned failed recipients.
- Legacy 23:30 plus 30 minutes wraps to 00:00 in the migration/default-time code. The database rejects that as end-before-start; the feed likewise defaults to same-day 00:00 instead of next-day midnight. The SQL rejection was reproduced.
- ICS escaping now covers CRLF/LF, but leaves a standalone carriage return intact. The production serializer reproduced this. Normalize all newline forms before escaping; do not claim strict RFC compliance until tested with an independent parser.
- The ICS tests copy the serializer/hash implementations instead of importing the production exports. They cannot catch regressions in the actual Edge source. The current CI does not type-check Edge functions, reset/upgrade a database, or run API authorization/concurrency tests. Its workflow runs on pushes to main, not pull requests.

**Fix/test:** Page and queue notification recipients, report accepted/failed/skipped outcomes honestly, normalize midnight to the next date, share the real serializer with tests, and add Edge/database/PR CI gates. Include 101+ recipients, provider failure, legacy 23:30, bare CR, multibyte folding, invalid dates, token revocation, and independent ICS parsing.

## Disposition of the original 19 findings

“Implemented” here describes source/local verification, not production deployment verification.

| Original ID | Reevaluation |
| --- | --- |
| S1 Privilege escalation | Core mitigation implemented: hardcoded signup role and protected profile updates; self-promotion rejected in isolation. Migration/provisioning blockers prevent declaring rollout complete. |
| S2 Public data/token exposure | Partial: anonymous reads closed and tokens hashed separately; pending/ordinary accounts still read broad private data; old token migration preserves existing links. R8/R12. |
| S3 Booking eligibility/ownership | Partial: owner/license/approval/tool checks added; project and historical/active mutation rules missing. R7. |
| S4 Email abuse | Partial: arbitrary recipient/raw HTML removed and approval checked; fabricated cancellation/replay/quotas unresolved. R4. |
| S5 Double booking | Constraint implemented; overlapping INSERT rejected with SQLSTATE 23P01. Full migration and concurrent-session verification still needed. R2. |
| L1 Legacy update data loss | Transactional RPC is an improvement, but it introduces cross-owner deletion. R1 blocks release. |
| L2 Legacy normalization | ID preservation and utility idempotence tests pass. Raw dashboard legacy end fallbacks are still inconsistent (`23:59` upcoming vs `00:00` past), and midnight conversion needs repair. R13. |
| L3 Timezones | Local date-key bug improved, but lab timezone and date-only parsing remain wrong across browsers. R6. |
| L4 License-free equipment | Implemented; eligibility tests pass. |
| L5 Mutation results/concurrency | Partial: drafts survive create/update failures and several writes verify rows; cancellation/status and concurrent array replacement remain. R9. |
| L6 Profile gate | Missing/error profile now fails closed and duplicate profile fetch removed. Revocation/session transitions still need authoritative refresh/reset. R8. |
| L7 Drag/layout | Invalid-date logging removed and bounds guarded; pure overlap-cluster layout tests pass. Touch cancellation/unmount cleanup still lacks dedicated coverage. |
| S6 ICS integrity | Hash lookup, server-side scope, escaping/folding and cache controls added. Real serializer integration, pagination, newline/midnight cases still incomplete. R5/R13. |
| P1 Query/polling scale | Partial and regressed in places: concurrent initial reads, sequence checks and hidden-tab suspension added; modal/admin windows, truncation, overlaps and loading race remain. R5/R10. |
| P2 Calendar rendering | Some memoization improved; no per-day occupancy index or measured drag-performance evidence. Hook still receives an inline completion callback and updates state on each move. |
| P3 Email fan-out | Concurrency limited to five and provider errors inspected; hard recipient cap, serial lookups, retries/outbox and UI failure reporting unresolved. R13. |
| P4 Assets/code splitting | Admin component split and image lazy-loading added. JPEG bytes unchanged (~6.65 MB); login still eagerly imports dashboard. Main gzip JS is slightly larger (127.25 vs 126.35 kB), so startup improvement is not established. |
| Q1 Dependencies | npm lockfile advisories resolved in current audit. Separate Edge imports remain loosely pinned and outside that audit. |
| Q2 Migrations/verification | Lint, actual booking utility assertions, Node version documentation and build gates improved. Database reproducibility and actual Edge/backend tests remain blockers. R2/R3/R13. |

## Revised completion plan

1. **Repair R1 first**, and add mixed-owner/mixed-group authorization tests before exposing the RPC. Review every SECURITY DEFINER operation for complete row-level authorization; these functions execute with their owner's privileges ([Supabase RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security)).
2. **Make installation and upgrade reproducible:** fix R2/R3, cover legacy midnight/invalid/overlapping data, verify first-admin provisioning, and add a disposable Supabase database job for fresh and upgrade paths. Do not resolve bad legacy data by silently deleting reservations.
3. **Complete backend policy and events:** repair R4/R7/R8, move cancellation/notification creation into a validated transaction, implement deduplication/quotas, and protect pending-user/private-data access.
4. **Correct data loading and time handling:** repair R5/R6, then the R9–R12 interaction/state regressions. Add browser tests with mocked time and delayed/failed requests, plus seeded data beyond response caps.
5. **Finish integration and performance work:** address R13, exercise real serializers and Edge types, run two-session database contention tests, measure calendar drag/network behavior, and resize images. Retain the now-passing lint/build/unit/audit checks.

Reevaluate for release only after R1–R8 are fixed and the real database/Edge integration gates pass. The changes in this branch should not yet be described as completing the original audit plan. This review adds this report only; no application fixes or deployment changes were made. An unrelated change to `supabase/.temp/cli-latest` appeared during the review and was left untouched.
