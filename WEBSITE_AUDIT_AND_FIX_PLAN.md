# Equipment booking website: audit and fix plan

Reviewed: 2026-09-27. Application commit: `bacd031`.

## Scope and confidence

Reviewed the React booking interface, authentication/profile loading, Supabase queries, all three Edge Functions, the migration directory, locally available archived SQL, dependencies, and deployment workflow. Ran the production build, lint, dependency audits, the existing booking script, and isolated reproductions against the actual booking utilities.

No deployment URL, configured application environment, test accounts, or live database policy export was supplied. This is a source review with local verification, not a penetration test of the deployed service. No live bookings were changed or messages sent. Database findings below are conditional on the supplied SQL matching the deployment; the archived SQL is incomplete and is not an authoritative deployment history. Performance findings are based on query/render structure and build measurements, not measured production latency.

Priority: **P0** = contain immediately if deployed; **P1** = resolve before the next production release; **P2** = subsequent reliability/performance work. “Confirmed” means visible in source or reproduced locally, not necessarily exploited in production.

## Highest-priority findings

### S1 — P0: Users can grant themselves privileges under the supplied profile design

**Evidence:** `sql_archive/supabase_schema.sql:41-58`, `sql_archive/add_approval_column.sql:13-21`, `sql_archive/add_projects_to_profiles.sql:8-17`.

The signup trigger copies `access_level` from user-controlled signup metadata. The own-profile INSERT/UPDATE policies restrict the row ID but do not protect `access_level`, `licenses`, `projects`, or `is_approved`. With the necessary table privileges, an ordinary account could submit admin metadata at signup or update its own authorization fields through the API. Hiding admin controls in React does not prevent these requests. This is a critical defect in the supplied SQL; deployed exploitability needs policy/grant verification.

**Fix:** Hardcode new accounts to an unapproved ordinary-user role. Move authorization data into protected tables or revoke general writes and expose narrowly scoped profile/admin operations. Allow self-service updates only to explicitly permitted fields. Validate admin authority using protected data, and secure any SECURITY DEFINER helper with a fixed search path and restricted EXECUTE privileges. Replace unsafe policies rather than merely adding restrictive-looking policies alongside them: permissive policies can combine to preserve access. Supabase explicitly warns against using user metadata for authorization ([RLS documentation](https://supabase.com/docs/guides/database/postgres/row-level-security)).

**Acceptance:** In an isolated database, anonymous, pending, and ordinary accounts cannot set their own role, approval, licenses, or assigned projects, either during signup or afterward. An authorized admin can make the intended changes. Admin policy evaluation must not recurse through the same protected profile table.

### S2 — P0: Public reads can expose profile data, booking details, and calendar bearer tokens

**Evidence:** `sql_archive/supabase_schema.sql:41`, `sql_archive/fix_booking_rls.sql:7-15`, `supabase/migrations/20231214_add_calendar_token.sql:2-6`, `supabase/functions/serve-ics/index.ts:19-41`, `src/components/UserManagement.jsx:14-20`.

The supplied SELECT policies use `USING (true)`. If anonymous SELECT grants are present, profiles and bookings are readable without signing in. Profiles now include the plaintext calendar token; bookings contain names and projects. Anyone able to read a token can use the calendar link. User management also fetches and logs complete profile rows, unnecessarily copying tokens into browser state and logs.

**Fix:** Separate minimal availability information from private booking details. Restrict directory/profile access to the intended roles and fields. Store calendar token hashes in a private table; expose only owner-controlled creation/revocation and a server-side token lookup. Never expose hashes or raw tokens through directory queries. Revoke existing calendar links after closing the read exposure if deployment review confirms they were accessible. Do not treat the browser's Supabase anonymous key as a secret; enforce access at the database boundary ([Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys)).

**Acceptance:** Anonymous and unrelated users cannot enumerate tokens or private profile/booking fields. Authorized users can still see permitted availability. Old revoked links fail; a new link returns only its owner's calendar.

### S3 — P1: Booking eligibility and ownership are not enforced by the supplied INSERT policy

**Evidence:** `sql_archive/fix_booking_rls.sql:13-15`, `src/components/BookingModal.jsx:89-92,665-675`, `src/components/Dashboard.jsx:149-170,271-315`.

The INSERT policy checks only whether a caller is authenticated. It does not require `user_id = auth.uid()`, approval, a valid license, an available tool, an allowed project, or valid timing. The browser supplies owner/name/tool metadata. Under this policy, direct API requests can impersonate another booking owner or bypass UI eligibility. Update policies restrict ownership/admin status but do not enforce the booking business rules. Actual deployed constraints and grants remain unknown.

**Fix:** Implement authoritative create/update/cancel operations with server-derived actor identity, validated tool and project membership, approval/license/status checks, and an explicit admin override policy. Protect direct table writes as well as RPC paths. Validate duration, interval ordering, date/time format, and the chosen rules for started/past bookings. Derive display names from trusted records. Audit overrides and sensitive changes.

**Acceptance:** Direct API tests reject forged owners, pending accounts, unlicensed use where required, unavailable tools, invalid intervals, and unauthorized changes. Allowed license-free bookings and audited admin actions succeed.

### S4 — P1: Authenticated users can abuse both email functions

**Evidence:** `supabase/functions/send-email/index.ts:39-99`; `supabase/functions/notify-cancellation/index.ts:48-125`.

`send-email` verifies a login but accepts arbitrary recipient addresses, user IDs, subjects, and HTML/text. It can send attacker-chosen content under the application's sender identity. `notify-cancellation` accepts a tool, claimed cancellation details, and sender identity without verifying a cancellation or ownership; a caller can repeatedly notify licensed users about invented cancellations. Neither function checks approval, application-level quotas, or idempotency. These authorization gaps are confirmed in function source; deployment/gateway reachability was not tested. Wildcard CORS is not the root cause and restricting CORS alone will not fix it.

**Fix:** For booking messages, accept a booking ID and bounded message content, authorize the sender, and derive the recipient and sender attribution server-side. Remove arbitrary `to` and raw HTML capabilities unless separately authorized. Generate cancellation notifications from an authorized committed cancellation event. Add authenticated-user quotas, recipient limits, request-size validation, deduplication, and an audit trail. Use a durable outbox so notification failure does not undo or misrepresent cancellation.

**Acceptance:** Arbitrary external recipients, forged cancellations, pending accounts, and replayed events cannot send mail. Authorized booking messages succeed. Use a fake mail provider for tests.

### S5 — P1: Double-booking protection is incomplete and unsafe under concurrency

**Evidence:** `sql_archive/migration_v2.sql:12-31`, `src/utils/bookingUtils.js:126-161`, `src/components/BookingModal.jsx:616-685`.

The archived trigger compares only exact start times, so 09:00–10:00 and 09:30–10:30 pass its comparison. Its SELECT-before-write check also allows concurrent transactions to miss each other. Creation uses a potentially stale client snapshot; editing does not repeat the final collision check before saving. No interval exclusion constraint appears in the supplied migrations. This is confirmed for the supplied implementation, with deployed constraint coverage unknown.

**Fix:** Add a database exclusion constraint for overlapping half-open intervals per tool, backed by GiST and `btree_gist`. Prefer explicit `starts_at`/`ends_at` instants and `tstzrange(starts_at, ends_at, '[)')`; include `NOT NULL` and `ends_at > starts_at`. Resolve existing overlaps before enabling the constraint. Keep client checks for feedback, but handle database conflicts clearly. PostgreSQL documents this exact resource-reservation pattern ([range exclusion constraints](https://www.postgresql.org/docs/15/rangetypes.html#RANGETYPES-CONSTRAINT)).

**Acceptance:** Concurrent overlapping creates/updates for one tool permit at most one winner. Adjacent intervals and bookings on different tools succeed. An admin override must not silently bypass exclusivity unless an explicit business requirement defines that exception.

## Booking and calendar correctness

### L1 — P1: Editing legacy slot groups can permanently lose reservations

**Evidence:** `src/components/Dashboard.jsx:277-315`.

The update handler deletes secondary legacy slots before validating the new interval or updating the retained row. If validation or the update fails, deleted slots remain lost. If deletion fails, the code continues and can leave inconsistent overlapping records. These are separate network/database transactions.

**Fix:** Convert/edit the entire group in one database transaction, with ownership checks, locks, validation, and conflict enforcement before commit. Prefer a one-time migration to canonical ranges once legacy data is validated. Until conversion is available, disable unsafe legacy editing rather than risk partial deletion.

**Acceptance:** Inject a failure after each internal step and verify all original rows survive unchanged. A successful edit produces exactly the expected canonical reservation.

### L2 — P1: Legacy booking support loses IDs and omits bookings from lists/feeds

**Evidence:** `src/utils/bookingUtils.js:29-38`; `src/components/BookingModal.jsx:225-251`; `src/components/Dashboard.jsx:561-584`; `supabase/functions/serve-ics/index.ts:82-90`.

Regrouping an already grouped legacy booking replaces its `ids` array with `[b.id]`. The modal replaces raw slots with an edited group and then groups again; later interactions can lose the IDs needed to update/cancel the whole reservation. Locally, a group with IDs `[1,2]` became `[1]` after regrouping. Separately, raw legacy rows have no end time: dashboard past/upcoming filters build an invalid Date and omit them from both lists, while calendar export attempts to format an invalid end date and can fail the entire feed.

**Fix:** Preserve all group IDs through normalization, use a single canonical booking representation at every boundary, and supply `start + 30 minutes` for legacy end times during migration. Make normalization idempotent. Handle invalid legacy data explicitly instead of dropping it or crashing an entire feed.

**Acceptance:** Normalize twice without changing IDs or duration; move, resize, and cancel a multi-slot legacy booking without residual rows. Mixed legacy/range datasets appear in the correct lists and export successfully.

### L3 — P1: Calendar dates and time rules mix UTC, browser time, and lab time

**Evidence:** `src/components/BookingModal.jsx:155-185`; `src/components/UserBookingsCalendar.jsx:72-85`; `src/hooks/useBookingInteraction.js:19-22,188-198`; `supabase/functions/serve-ics/index.ts:9,82-87`.

Grid keys use `toISOString()` (UTC), headings and comparisons use browser-local time, and ICS assumes Europe/Vilnius. For example, Vilnius 2026-09-28 00:30 becomes a `2026-09-27` date key. Users in other zones can see a heading, booking date, and exported event that disagree. Time objects also retain the time-of-day from initial week selection. Current-slot booking is allowed by one check while drag rules require future starts; the intended policy needs to be made explicit.

**Fix:** Declare the lab timezone centrally, use calendar-date values for grid dates, and convert to instants at a single validated boundary. Display the timezone. Define current-slot, past-booking, midnight, and DST behavior; represent midnight as the next day's 00:00 when storing instants. Use server time for authoritative eligibility.

**Acceptance:** Tests in UTC, Europe/Vilnius, and America/Los_Angeles produce the same lab reservation. Include midnight, Sunday/Monday transitions, 23:30–24:00, and both DST transitions, including ambiguous/nonexistent local times.

### L4 — P1: License-free equipment is incorrectly blocked

**Evidence:** `src/components/ToolList.jsx:64-67,166-167`; `src/components/BookingModal.jsx:89-92`.

The equipment list recognizes `license_req = false`, but the booking modal requires a license for every ordinary user. A tool marked “Not Required” therefore opens a modal that refuses selection.

**Fix:** Centralize eligibility as approval plus available status plus `!tool.license_req || hasLicense`, with separately specified admin exceptions. Enforce the same policy server-side (S3).

**Acceptance:** An approved unlicensed user can book an available license-free tool, cannot book a license-required tool, and receives correct feedback for down/service equipment.

### L5 — P1: Failed or zero-row writes can look successful and discard edits

**Evidence:** `src/components/Dashboard.jsx:220-228,311-333,339-347`; `src/components/BookingModal.jsx:625-629,685-687`; `src/components/UserManagement.jsx:41-55,69-81,99-109`.

Updates/deletes often check only `error`, not whether the intended rows were actually affected. A stale ID or RLS-filtered operation can return no affected rows while the UI reports success. The dashboard catches errors without returning failure; the modal then clears editing/selection state even after a failed save. License/project changes replace full arrays calculated from stale browser state, so simultaneous admin changes can overwrite one another.

**Fix:** Return explicit mutation results, verify expected returned IDs/counts, retain drafts on failure, and use `try/finally` for submission state. Add revision-based optimistic concurrency or transactional add/remove operations for bookings and entitlements. Merge only authoritative returned rows into state.

**Acceptance:** Simulate denied, stale, conflicting, and failed writes. No false success is shown and drafts remain retryable. Concurrent independent license grants are both retained; stale edits receive a conflict response.

### L6 — P1: Missing profiles fail open at the UI gate; approval changes can remain stale

**Evidence:** `src/components/DashboardWrapper.jsx:10-27,37-60`; `src/components/Dashboard.jsx:15-19,63-71`.

A missing/failed profile load leaves `profile = null`, which bypasses the pending-approval screen and renders the dashboard. The wrapper does not reset loading/profile when sessions change, cancel obsolete reads, or refresh approval periodically. The dashboard ignores the supplied profile prop and independently loads another profile. Approval/revocation state can therefore disagree between the two components. This confirms a UI defect; actual data access depends on backend policies.

**Fix:** Use one account/profile state source with explicit loading, error, missing, pending, approved, and revoked states. Fail closed for protected views, reset state on account changes, discard outdated responses, and offer retry/logout. Refresh authorization when appropriate, while keeping database enforcement authoritative.

**Acceptance:** Missing profile, network failure, rapid logout/login, approval, and revocation all produce the correct state without rendering another account's cached data.

### L7 — P2: Dragging outside day bounds can throw; event layout is incorrect

**Evidence:** `src/hooks/useBookingInteraction.js:188-225`; `src/utils/bookingUtils.js:164-212`.

An out-of-bounds drag generates an invalid time such as `-1:00`. The validation-failure logger then calls `toISOString()` on the invalid Date, throwing before the interaction ref is updated. A mouse-up can consequently use the previous valid drag state. Layout also assigns one column count to the entire day, so a noon event remains half-width merely because two morning events overlapped. `calculateEventLayout` mutates input booking objects by adding `colIndex`.

**Fix:** Clamp or reject numeric offsets before constructing dates and mark the interaction invalid without throwing. Clear interactions on cancellation/unmount. Calculate widths per connected overlap group and keep layout calculations pure.

**Acceptance:** Drag above 00:00/below 24:00 and cancel touch interactions without exceptions or unintended saves. An isolated noon event occupies full width even after morning overlaps; layout leaves its inputs unchanged.

### S6 — P1: ICS output permits content injection and depends on public table access

**Evidence:** `supabase/functions/serve-ics/index.ts:29-41,53-62,100-111`; no checked-in `supabase/config.toml`.

Tool names, project text, and locations are inserted directly into ICS lines. CR/LF can create additional properties/events; commas, semicolons, and backslashes are not escaped and long lines are not folded. This is calendar-content injection, not demonstrated browser JavaScript execution. The function uses an anonymous database client, so tightening the public policies in S2 would break it. Gateway JWT settings are absent; a normal calendar client cannot attach a Supabase login JWT, so deployment settings also need verification.

**Fix:** Use a tested RFC 5545 serializer with text escaping, CRLF output, UTF-8-safe folding, and explicit invalid-date handling. Resolve a hashed token in trusted server code and scope all subsequent reads to its owner. Configure only this token-authenticated endpoint for calendar-client access without a login JWT. Add token redaction in logs and private/no-store caching. Preserve other functions' authentication requirements. See [RFC 5545](https://www.rfc-editor.org/info/rfc5545/).

**Acceptance:** Newlines and punctuation in projects/names cannot add events. Validate with an independent ICS parser and an actual calendar client. Token rotation, owner scoping, DST, and legacy rows work after public table reads are removed.

## Performance and operational reliability

### P1 — P1 priority: Full-table polling wastes work and silently truncates data

**Evidence:** `src/components/Dashboard.jsx:50-101`; `src/components/UserManagement.jsx:14`; `supabase/functions/serve-ics/index.ts:51-62`.

Each dashboard performs three sequential queries every 10 seconds, including all booking columns across all history. That is roughly 18 reads/minute per open dashboard before mutations. Requests can overlap and resolve out of order, replacing newer state with stale data. Profile loading is duplicated between wrapper and dashboard. No pagination or stable ordering is applied to bookings. Supabase's default response cap is 1,000 rows, so calendars, collision previews, admin filters, and feeds can be incomplete as data grows ([select documentation](https://supabase.com/docs/reference/javascript/select)).

**Fix:** Query the visible tool/week, separately page personal history and admin results, select needed fields, and use deterministic ordering/cursors. Fetch independent initial data concurrently and share the profile cache. Use scoped realtime invalidation or non-overlapping polling with backoff, hidden-tab suspension, cancellation, and response versioning. Add indexes matching actual filters, e.g. `(tool_id, date)` and `(user_id, date)` if retaining the current schema; inspect query plans before adding redundant indexes. Page calendar exports or define and document a bounded feed window.

**Acceptance:** Seed more than the configured row limit; bookings remain discoverable and availability is accurate. Delay/reorder responses to prove older reads cannot overwrite newer state. Background tabs stop unnecessary polling. Compare request counts and query plans before/after.

### P2 — P2 priority: Calendar interactions repeatedly scan and regroup broad datasets

**Evidence:** `src/components/BookingModal.jsx:188-205,225-252,386,756-773`; `src/hooks/useBookingInteraction.js:102-287`; `src/components/Dashboard.jsx:104-124`; `src/components/UserBookingsCalendar.jsx:161-164`.

Selection repeatedly scans bookings for each candidate slot; each render scans selected slots for each of 336 grid cells. Dragging updates React state on mouse/touch movement, and the inline completion callback causes the global event-listener effect to be recreated on renders. `myBookings` is a new array on every dashboard render, invalidating downstream memoization. These costs increase with history and concurrent bookings.

**Fix:** First bound fetched data (P1), then index it by tool/day, precompute selected-slot sets and per-day layouts, memoize actual dependencies, and stabilize listeners/callbacks. Update drag previews only when snapped coordinates change or once per animation frame. Virtualize long admin lists only if measurement warrants it.

**Acceptance:** Profile a seeded busy week and large history on a representative laptop and phone. Target drag frames within a 16.7 ms budget at 60 Hz and no interaction-induced long tasks above 50 ms; record measured results rather than assuming improvement.

### P3 — P2 priority: Cancellation fan-out is unbounded and mail failures are misreported

**Evidence:** `supabase/functions/notify-cancellation/index.ts:72-127`; `supabase/functions/send-email/index.ts:91-102`; `src/components/BookingModal.jsx:64-74`.

Cancellation loads profiles broadly, filters in memory, performs one Auth lookup per recipient, then sends one email per recipient with unbounded `Promise.all`. Large recipient sets can exceed function/provider limits, and the profile query can truncate at the response cap. Resolved provider error objects are not inspected: cancellation counts attempted recipients as notified, and `send-email` wraps the provider response in HTTP 200, which the browser treats as success. The provider exposes a distinct `error` result ([Resend send API](https://resend.com/docs/api-reference/emails/send-email)).

**Fix:** Filter eligible/approved recipients in the database using an indexed entitlement relation; page recipients, process a durable queue with bounded concurrency, and honor provider retry limits. Inspect every provider outcome and track queued/accepted/failed status separately from actual delivery. Deduplicate event-recipient pairs. Keep email lookups private and remove unnecessary PII logging.

**Acceptance:** Test a large recipient population, missing email, provider rejection, throttling, and retries. Notifications are neither silently skipped nor duplicated, and counts reflect the reported status accurately.

### P4 — P2 priority: Oversized equipment images and eager application code

**Evidence:** `src/assets/tool_images/1.jpg` (2,190,227 bytes), `5.jpg` (2,520,983 bytes), `6.jpg` (914,360 bytes), `7.jpg` (890,754 bytes); `src/components/ToolList.jsx:4,85-93`; `src/App.jsx:6`; `src/components/Dashboard.jsx:5-10`.

The build emits about 6.65 MB of equipment JPEGs and a single 447.47 kB JS bundle (126.35 kB gzip). Large source images are used for small detail panels. The images render only when a row expands, so this is not evidence that all image bytes download at startup. Login nonetheless imports the dashboard and its admin components eagerly.

**Fix:** Generate appropriately sized WebP/AVIF thumbnails with a compatible fallback and intrinsic dimensions; lazy-load detail media. Split dashboard/admin code at feature boundaries after measuring startup. Suggested budget: typical detail thumbnails below 150 kB with visually acceptable quality.

**Acceptance:** Inspect the network waterfall for login and expanded tool rows, verify responsive image quality, and compare transferred bytes and startup measurements.

## Dependencies, migrations, and verification gaps

### Q1 — P1: Locked dependencies have known advisories

`npm audit --json` reported **15 affected packages: 11 high, 3 moderate, 1 low; 0 critical**, as of this review. `npm audit --omit=dev --json` reported **one high-severity affected package**, `ws@8.18.3`, through `@supabase/realtime-js@2.86.0`. These counts are affected-package counts, not distinct exploitable application vulnerabilities.

Relevant locked versions include Vite 7.2.4, Rollup 4.53.3, PostCSS 8.5.6, and ws 8.18.3. Vite advisories include development-server file reads/deny bypasses; `vite.config.js:9` exposes the dev server on all interfaces. Static GitHub Pages does not run that dev server. Browser Supabase uses the native WebSocket implementation, so the ws result does not by itself establish a browser vulnerability. Edge imports resolve separately from npm and were not covered by the npm audit.

**Fix:** Upgrade compatible direct dependencies and regenerate the lockfile, then retest rather than blindly applying forced upgrades. Restrict development-server binding to localhost unless deliberately needed. Pin/lock the Edge Function dependency graph and audit it separately. Review reachability and document any accepted residual advisories.

**Acceptance:** Fresh install, build, lint, booking/auth tests, and Edge Function checks pass with no unexplained high/critical reachable advisories. References: [Vite dev-server advisory](https://github.com/advisories/GHSA-p9ff-h696-f583), [Rollup path traversal](https://github.com/advisories/GHSA-mw96-cpmx-2vgc), [ws memory exhaustion](https://github.com/advisories/GHSA-96hv-2xvq-fx4p).

### Q2 — P1: Database state is not reproducible, and release checks miss defects

**Evidence:** `supabase/migrations/20231214_add_calendar_token.sql`; `sql_archive/supabase_schema.sql:23-39`; `.github/workflows/deploy.yml:23-35`; `test_booking_logic.js`; `eslint.config.js:10`; `readme.md:36`.

The only normal migration adds a token column to an assumed existing profiles table. The archived baseline has a stray `);`, no profiles CREATE TABLE, and no booking `end_time` definition; there is no complete fresh-install schema. The unique token column also receives a redundant additional ordinary index. The deployment workflow runs a build but no lint, tests, database migration validation, or Edge TypeScript checks. The existing booking script duplicates implementation code and prints four booleans without assertions, so it can exit successfully despite wrong behavior. ESLint's configured files exclude the TypeScript functions. README says Node 16+, but installed Vite requires `^20.19.0 || >=22.12.0`.

**Fix:** Export and review the actual database schema/policies/grants before designing upgrades. Add a versioned baseline and forward migrations, including constraints and Edge configuration. Reconcile legacy data explicitly; remove duplicate indexes after inspecting deployed definitions. Test actual production utility imports and API boundaries. Add lint, unit/integration tests, Edge type checks, fresh-database migration tests, and upgrade tests to CI before deployment. Align documented/runtime Node requirements and validate required build configuration.

**Acceptance:** An empty database can be initialized from tracked files; a representative existing database upgrades without data loss. CI fails on a failed assertion, unsafe authorization regression, missing configuration, invalid migration, or Edge type error.

## Execution plan and release gates

| Phase | Work | Dependencies | Release gate |
| --- | --- | --- | --- |
| 0. Establish deployment truth and contain | Snapshot/backup schema and data; inspect RLS, grants, triggers, functions, API row cap, and function JWT settings. Check S1/S2 exposure. Restrict unsafe privilege writes/public reads and disable unrestricted email sending if confirmed deployed. | Read access to deployment configuration; coordinate any maintenance window. | Ordinary users cannot elevate privileges or enumerate private data; safe staging copy is available. |
| 1. Secure database and mutations | Implement S1–S3/S5 and L1; reconcile invalid/overlapping legacy records; introduce protected roles/entitlements, range constraints, transactional writes, audit records, revisions, and migration tests. | Phase 0 schema inventory. | Role matrix, forged-input tests, concurrency tests, and rollback tests pass. |
| 2. Repair integrations | Implement S4/S6/P3: authorized booking messages, cancellation outbox, private hashed calendar tokens, correct serializer, recipient filtering, and bounded retries. Coordinate token endpoint changes with removal of public reads. | Protected database APIs and events. | Fake-provider tests, calendar parser/client checks, revocation and replay tests pass. |
| 3. Repair booking UX | Implement L2–L7: canonical normalization, lab timezone, license-free eligibility, reliable mutation results, unified profile state, safe dragging, and correct layout. | Stable API contracts from phases 1–2. | Browser scenarios pass for ordinary/admin/pending users, legacy bookings, mobile touch, timezone boundaries, and failed requests. |
| 4. Bound resource use | Implement P1/P2/P4: bounded/paged queries, safe refresh, indexed calendar data, stable render dependencies, responsive images, and measured code splitting. | Canonical schema and UI state. | Large datasets remain complete; request counts, payloads, query plans, and interaction traces show measured improvement. |
| 5. Enforce release quality | Address Q1/Q2, repair lint, add automated gates, and update setup documentation. Start dependency remediation early alongside other phases. | Tests established in earlier phases. | Reproducible install/build/schema; required tests and security checks green; documented deployment and recovery steps. |

Use separate reviewable changes for database controls, integrations, UI correctness, performance, and dependency updates. Do not deploy new client assumptions ahead of compatible backend changes. Backfill and reconcile records before enabling stricter constraints, and retain a verified backup. Recovery must preserve closed authorization boundaries; do not restore unsafe public/write policies as a convenience rollback. Calendar token rotation requires users to resubscribe and should be communicated as part of rollout.

## Verification performed

| Check | Result |
| --- | --- |
| `npm ci --ignore-scripts --no-audit --no-fund` | Passed after sandbox network restriction was resolved. Lockfile unchanged. |
| `npm run build` | Passed after rerunning outside sandbox filesystem restrictions; 135 modules, 447.47 kB JS / 126.35 kB gzip, 51.72 kB CSS / 8.80 kB gzip. Build success does not verify runtime Supabase configuration. |
| `npm run lint` | Failed: 21 errors, 5 warnings. Mostly unused code, Fast Refresh export separation, and missing effect dependencies. |
| `node test_booking_logic.js` | Printed expected collision booleans `false,true,false,true`; contains no assertions and uses copied helpers. |
| Production utility probes | Regrouping `[1,2]` lost ID 2; missing legacy end yielded Invalid Date; an isolated noon event was 50% width after morning overlap; layout mutated its input. |
| Date/drag probes | Vilnius 2026-09-28 00:30 formatted to UTC date 2026-09-27; a negative drag time produced Invalid Date, which is unsafe for the logger's `toISOString()`. |
| Dependency audit | 15 affected packages overall; one affected package when dev dependencies are excluded. No package upgrades applied. |
| Live/backend verification | Not performed: deployed policies, actual data, browser end-to-end flows, mail delivery, Edge runtime behavior, and production performance remain to be checked in staging. |

Only this report is an intended source change. Dependencies/build output were generated locally for verification; application code and deployment were not modified.
