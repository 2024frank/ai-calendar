# Pilot acceptance and research protocol

This is the release checklist for the September 2026 reliability/evidence changes. Code-level regression results and a component preview are not a live pilot trial. Keep private meeting transcripts, downloaded calendars, credentials, and participant data out of this repository.

## Database upgrade

Two migrations have deliberately separate responsibilities:

- `0002_historical_schema_catchup.sql` brings the previously committed migration history up to the schema already used by the application at commit `468ad08`: activity logging, learnings, corrected-at tracking, and expanded mode/status/run enums.
- `0003_pilot_reliability_evidence.sql` adds correction-request tracking and lease tokens, the recurrence-proposal link/resolution timestamp, create/update outbox operation and endpoint provenance, and retained research evaluations. Existing outbox rows default to `create`; new fields on existing events/submissions remain nullable.

The real MySQL 8.4 rehearsal also exposed a syntax defect in the older `0001`: `jobs.updated_at` and `rate_limit_buckets.updated_at` declared `timestamp(3)` but used `ON UPDATE CURRENT_TIMESTAMP` without matching precision. Those two clauses now use `CURRENT_TIMESTAMP(3)` so fresh installations can reach the later migrations. This is a bootstrap SQL repair, not a request to replay an already-applied migration. Existing deployments must compare the actual columns and journal during rehearsal; the historical SQL file's hash changes, and no deployed journal is silently rewritten here.

Neither migration drops a table or column. Enum expansion and foreign-key creation still acquire database locks; use a maintenance window appropriate to the target dataset. Evaluations restrict deletion of their source/community to preserve evidence. They retain the creator's ID, name, and email in an immutable snapshot even if the account is later deleted; restrict exported evidence accordingly. They are append-only through the app, not tamper-proof against database administrators.

**Fresh development database:** run the complete migration chain using an isolated, empty MySQL database. Then bootstrap a test community as described in the README.

**Existing deployment:** back up and rehearse against a restored staging copy first. Compare the actual schema and Drizzle journal with both SQL files. Older deployments may already have the catch-up objects from manual changes; blindly replaying `0002` would fail with duplicate table/column errors. Do not mark it applied unless every statement's effect is present and verified. Have the operator reconcile this historical drift before applying `0003`. No production migration is performed by a code push or this checklist.

### Real MySQL isolation suite

`npm run test:mysql` is separate from the fast `npm run check` suite. It requires a dedicated loopback MySQL server and both `AI_CALENDAR_TEST_MYSQL_URL` (server URL only, no database path) and `AI_CALENDAR_ALLOW_TEST_DATABASE_CREATE=1`. Supply test-only credentials through a protected environment. The command never loads `.env.local` or application `DATABASE_*` credentials. It creates a uniquely named `ai_calendar_test_...` database, applies the complete migration chain, tests independent-connection publication/correction locks and foreign keys, and drops only that generated scratch database in cleanup. An interrupted process may leave that uniquely named test database for the operator to inspect and remove.

The `mysql-isolation` job in `.github/workflows/quality.yml` supplies an isolated MySQL 8.4 service with disposable credentials. It has no scheduled extraction or publishing and no production secrets. A configured CI job is not a passed CI run; review its result after an authorized push. Set both `verify` and `mysql-isolation` as required branch checks if enforcing the full gate.

### Separate synthetic publishing receiver

`npm run test:destination -- --port 4320` starts an in-memory HTTP receiver bound only to `127.0.0.1`. It supports create and same-ID update requests at the CommunityHub-shaped `/api/legacy/calendar/post/submit` and `/api/legacy/calendar/post/:id/submit` paths. Inspect stored synthetic posts at `http://127.0.0.1:4320/__synthetic__/posts`. Stop it with Ctrl+C; restarting clears its data.

Every title must start with `[SYNTHETIC TEST] `, bodies and retained records are bounded, and the receiver makes no outbound requests. It is not CommunityHub, a production integration, or a storage service for real records. Do not change a production destination to this loopback URL or weaken the production SSRF protections. The isolated publication integration test remaps only one exact synthetic hostname to its own local receiver; every other origin is rejected. Session/cookie and transport boundaries are synthetic, while the scoped route, publication/outbox logic, MySQL database, and receiver HTTP requests execute for real. This proves the application flow against the documented test contract, not live CommunityHub compatibility or a browser login journey.

## Reviewer and destination acceptance

Use synthetic events and a dedicated CommunityHub test destination. Test with both a reviewer and an unrelated community account.

1. Request a correction for a specific unsent event with a short, factual instruction. Confirm only that event is processed, the result returns to human review, and rejection is still a separate action. Simulate provider failure and retry. Save a manual edit or reject while correction is running; the late model result must not overwrite that decision.
2. Submit an event once, record its remote numeric post ID, edit a supported content field, and use the explicit update action. Confirm the same post changes without changing its moderation status, email/subscription behavior, or number of remote posts.
3. An unlinked event or a destination change must not invent a remote ID or create a replacement through the update action. Ambiguous responses must block another send until reconciliation.
4. Discover new dates for an already-sent event. Confirm the original is not silently changed and the proposed update remains visible to a reviewer. Follow the review/update path, checking the single remote post at the end.
5. Block the destination inventory. Confirm automated delivery remains held; correction or a no-op edit must not remove that hold.
6. Attempt each route with no session, a different community, and a reviewer without source access. No event or evaluation may leak across the applicable boundary.

Automatic and reviewer-requested corrections share one lease. A late response must match both its lease token and the original content before it can save. Test overlapping requests and a later manual edit/rejection, not just sequential successes.

Updates require the numeric post ID and exact submit endpoint recorded on a successful prior submission. Editing the endpoint in the same destination row must invalidate that link. Historical submissions with no endpoint provenance are held, not silently backfilled from today's configuration; operator verification of the original destination is required before safely linking them. The update response must contain a supported numeric-ID acknowledgment (`id`, `post_id`, or `post.id`) matching the target and no explicit failure. Empty, unreadable, malformed, oversized, or mismatched 2xx responses remain uncertain. This is a conservative supported acknowledgment format, not a live-verified guarantee about every CommunityHub deployment.

Recurring-date proposals cannot create a replacement post. Review their dates against the linked original, explicitly update that original if appropriate, and then use **Mark proposal resolved**. Resolution removes the proposal from the pending queue using the existing duplicate status plus a resolution timestamp; it does not write a rejection or teach an exclusion rule. Retention conservatively preserves every original referenced by a proposal, resolved or not, until the proposal expires. An original may remain for one additional sweep after its final proposal is removed. The self-referencing foreign key prevents an orphaning deletion race.

## Source-policy acceptance

Use a frozen source page/API fixture and a known community-local extraction date. Independently label expected results before running extraction.

- Apollo: distinguish currently playing films from films that open later, even if their show dates are adjacent. Include a closed day, December/January rollover, and a sequel with a number in its title. Retain complete film/date evidence for server-side duplicate checks. Saved access recipes must not override the shared canonical Apollo classification.
- Lookahead: a small source is not exempt from the selected horizon. Test dates just before, at, and after the cutoff, plus an ongoing event that started earlier.
- Riverdog: follow each event's own “More info and videos” detail link, including new-tab links, and verify descriptions against that page. Do not copy one band's description to another.
- An unavailable detail page should lead to a verified working parent/listing page, not an invented URL.

Deterministic policy tests do not prove that an external model always follows its prompt. A source-level trial must compare actual model results with the frozen reference.

## Research evaluation

The evaluation view accepts a bounded JSON document containing an independently collected reference, an extracted snapshot, and explicit one-to-one human-confirmed matches. The server saves the normalized input, provenance, comparison report, creator, source, community, and capture period. It does not fetch the supplied URLs, run extraction, publish events, or infer matches.

For every trial:

1. Declare source, community, period, inclusion rules, and whether the reference is complete, partial, or unknown. Use the same inclusion rules for both snapshots. The import period is start-inclusive/end-exclusive and selects events by their start instant; represent recurring occurrences with distinct row IDs when comparing occurrences rather than whole series.
2. Collect the reference independently of the model output and record who collected it and when in provenance. Do not label an incomplete reference as exhaustive.
3. Capture extracted results before reviewer corrections. Save a second separately titled evaluation after corrections if comparing improvement; preserve the originals.
4. Have a person confirm matches and inspect both unmatched directions and field differences. A reference-only row is a coverage gap in this declared sample. An extracted-only row could be a legitimate additional event, a duplicate, or an extraction mistake; it is not automatically a false positive.
5. Report sample sizes, period, sources, inclusion rules, reference completeness, and reviewer time actually measured. Reference coverage is confirmed matches / reference rows. An empty reference has undefined coverage, displayed as unavailable rather than 0% or 100%.

The app records reviewer feedback and can reuse lessons in later prompts. This is not model fine-tuning, proof of improved accuracy, or a controlled learning experiment. Operational quality counts describe current records, not immutable arrival quality. Estimated time saved is not measured reviewer time.

## Portability trial

Ask someone who did not build the system to create a separate community, invite a reviewer, configure one new source and its recipe, run extraction, review an event, and use a test destination. Record setup time, points where assistance was required, failures, and the documentation they used. Include both a structured calendar feed and a page without one. Do not remove existing manual submission routes until the pilot comparison supports that decision.

## Independent worker operation

`npm run worker:tick -- --help` performs no network request. A configured tick sends one bounded authenticated POST to `/api/internal/jobs`, recovers eligible stale leases, and drains a bounded batch through the existing worker route. It refuses redirects, non-loopback HTTP, query-string credentials, and CLI secret arguments. Only sanitized counters are printed.

Set `AI_CALENDAR_WORKER_URL` to the full intended endpoint and `WORKER_SECRET` in the scheduler's protected environment. The app route supports a `CRON_SECRET` fallback, but this runner intentionally requires an explicit `WORKER_SECRET`; if the app uses the fallback, provision the same value as the runner's worker secret. For a local staging test:

```bash
AI_CALENDAR_WORKER_URL=http://127.0.0.1:3000/api/internal/jobs npm run worker:tick -- --limit 1 --timeout-ms 290000
```

This example assumes `WORKER_SECRET` is already supplied securely by the shell or service. The runner does not automatically read `.env.local`. Do not paste a secret into a command, URL, log, or committed service file.

Install a managed scheduler or supervised worker in the intended environment, at a frequency the hosting plan supports. Alert on command failures, increasing queue age, and failed runs. An aborted client request can still be running server-side; the command does not blindly retry it. Test recovery after killing a chain, overlap two invocations, and measure actual queued-to-start latency. The existing daily Vercel cron and the presence of this command alone do not establish a two-minute queue objective.

## Release record

Before rollout record the commit, migration rehearsal, `npm run check` result, runtime dependency audit, desktop/mobile component checks, and test-destination results. After an explicitly authorized deployment check health/readiness, sign-in, source access, review queue, evaluations, worker execution, and a complete test-event journey. Record dates and evidence; do not mark unperformed checks passed.

### Earlier local checkpoint, September 5, 2026

This checkpoint predates the Docker restart and real-database follow-up below.

- Branch: `codex/pilot-reliability-evidence`, based on `468ad08`; changes have not been pushed or deployed.
- `npm run check`: passed, including 387 tests, lint, TypeScript, and production build.
- `npm audit --omit=dev --audit-level=moderate`: zero vulnerabilities reported. This is a dependency audit, not proof of an absence of security defects.
- `npx drizzle-kit check` and `git diff --check`: passed. Additive SQL generated and inspected, not applied.
- Synthetic desktop/mobile review and evaluation components inspected, including dark mode, failed correction, unverified destination, uncertain update, and resolved/unresolved proposal states. Latest 390px mobile checks had no horizontal overflow or captured console warnings/errors. Native confirmation interaction could not be completed by the in-app automation, so browser mutation flows are not claimed end-to-end; offline tests cover the actual command handlers with isolated boundaries.
- Separate 12-case real-MySQL suite added but **not executed** because the local Docker service did not respond. The CI job is configured but has not run. Test-destination/model compatibility, restored-database migration rehearsal, measured worker latency, retention contention at larger scale, and the independent human research/onboarding trials remain open.

### Docker and synthetic-destination follow-up, September 5, 2026

- User authorized restarting Docker, replacing the requested external test destination with a separate receiver, and a separate-branch push. Docker was restarted without a factory reset or deletion of existing Docker data.
- MySQL 8.4.11 ran in a disposable container with a loopback-only port and temporary memory-backed data directory. The initial real run exposed error 1294 in the historical timestamp update clauses described above; after the exact precision correction, the entire migration chain applied successfully to fresh scratch databases.
- `npm run test:mysql`: **16/16 passed**, including independent-connection claims/correction leases, retention foreign keys, proposal resolution, and four actual MySQL-plus-loopback-HTTP publication scenarios. Verified create-once, same-ID updates, unchanged suppression, preservation of independent remote moderation/subscription changes, uncertain-response reconciliation without resend, and tenant/session denial.
- `npm run check`: **395/395 regression tests**, lint, TypeScript and production build passed. Runtime audit reported zero vulnerabilities; Drizzle metadata and whitespace checks passed. Independent review found no blocking defects in the receiver, transport boundary, integration tests, or precision repair.
- Scratch databases were removed by test cleanup and verified absent. No production credentials/database, extraction model, email delivery, or CommunityHub endpoint was used. The standalone receiver can be inspected locally and restarted with the command above; its records are synthetic and temporary.
- This supersedes the earlier Docker/MySQL blocker only. A local receiver is not live CommunityHub compatibility, a production-restored migration rehearsal, browser sign-in verification, an installed scheduler, a scaling measurement, or a human research/onboarding trial. CI results are verified separately after push.

### Existing-database upgrade, September 5, 2026

- The existing AI Calendar database was upgraded in place on MySQL 8.0.45 at approximately 22:44 UTC. It was not replaced, emptied, or moved. Consistent compressed backups, complete table definitions, row-content hashes, and statement-by-statement maintenance records are retained privately outside Git.
- A fresh backup was restored into uniquely prefixed copy tables on the same database server. This exercised the actual production version and dataset, but it was not an isolated staging server. Every copied foreign key stayed within the copy set. All 17 statements in `0003_pilot_reliability_evidence.sql` succeeded; content hashes for every original column in all 24 restored tables were unchanged. Copy tables were removed after explicit foreign-key boundary checks, with foreign-key checking enabled throughout.
- After another fresh backup, exactly `0003` was applied to the real tables. Its SQL SHA-256 was `2fb89f74d7ca41554ef139d07cda1f68c3700d8f46b29f87b51f18abb1f2c0f1`. Post-upgrade checks confirmed all 23 new columns, their types/defaults, the new indexes and constraints, and unchanged original records, including 382 events and 12 sources. The resulting schema has 25 tables, 267 columns, and 34 foreign-key column entries. No temporary copy tables remain.
- Historical migrations were **not replayed or marked applied**. This deployment has no Drizzle journal and its separate `schema_migrations` table was empty. Existing drift includes wider `events.image_data`, historical enum/default differences, extra legacy tables, and missing historical indexes/one activity-log constraint. These were preserved deliberately. Do not run `db:migrate` blindly or assume `0002` is fully reconciled; compare the live schema and historical statements before adopting a journal or applying future migrations.
- GitHub [quality run 33996265366](https://github.com/2024frank/ai-calendar/actions/runs/33996265366) passed for implementation commit `416e028`: lint, TypeScript, 395 regression tests, production build, runtime dependency audit, and 16 isolated MySQL/HTTP tests. A fresh local 395-test rerun also passed. The local full-build retry was blocked by disk exhaustion; the successful GitHub build supplies that gate.
- No test event was sent to CommunityHub, no extraction was triggered, and production application TLS settings were not changed. The maintenance connection used a separately pinned, server-provided CA after an explicitly disclosed trust-on-first-use bootstrap; that is not independent CA authentication.
- This record establishes the database upgrade and automated-test evidence. Code deployment, authenticated browser journeys, actual provider behavior, installed worker scheduling, and human pilot measurements require their own verification; database readiness alone does not establish them.
