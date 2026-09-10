# Reliability and release checks

AI Calendar is a research pilot with a production deployment. Passing a build or a health probe does not prove that extraction, review, and delivery work end to end. Keep these levels of evidence separate.

## Regression gates

`npm run check` runs lint, TypeScript, tests, and the production build. The GitHub quality workflow also runs `npm audit --omit=dev --audit-level=moderate`. It has no scheduled extraction, publishing, or production credentials. Configure **Quality checks / verify** as a required branch check in GitHub to enforce it before merging; the workflow file by itself cannot enforce branch protection.

Tests cover actual route handlers and generated database queries with external services replaced, plus worker transitions against disposable in-memory SQL. They cover callback/result races, expired leases, completed-run preservation, publishing claims after payload edits, tenant-bound pending access, selected-community creation, malformed authentication requests, source URL identity, and timeline recovery. These tests do not prove MySQL locking behavior or an AI provider's external callback guarantees.

The separate `npm run test:mysql` suite applies migrations to a uniquely named, disposable database and exercises independent MySQL connections. Its explicit local-server prerequisites and the isolated CI job are documented in [PILOT-ACCEPTANCE.md](PILOT-ACCEPTANCE.md#real-mysql-isolation-suite). It is not silently skipped or counted as passing by the fast suite when no test server is available.

## Interface verification

Run `npm run ui:preview` and open the displayed loopback address. The fixture bundles the real components and CSS with explicit synthetic data. Check:

- At 390 px, open navigation, cycle Tab and Shift+Tab, then press Escape. Focus must stay inside the drawer while open and return to the menu button when closed. Main-page controls must be inert while the drawer is open.
- Switch communities without changing the route. The sidebar count and selected community must update together.
- Completed runs must show their recorded state immediately. Queued runs and callback waits must be named explicitly.
- Simulate a network outage. Retries must back off and eventually pause with a retry action. An expired session must offer sign-in without polling forever.
- At desktop and mobile widths, check light/dark themes, keyboard focus, and that tables scroll within their own region.

Local component-preview checks performed on 2026-09-05: 1440×900 desktop and 390×844 mobile, light/dark rendering, same-route community count changes, inert drawer background, forward/reverse focus wrap, Escape focus restoration, completed/callback-waiting states, expired-session sign-in, and eventual outage pause. No page-level horizontal overflow was present at those widths. These checks used synthetic data, not the full database-backed review/publishing flow.

## Worker operation

An extraction job retains its active dedupe key while the provider callback or ingestion is still pending. A shared conditional claim allows only one of the callback or normal response to ingest. Callback waiting has a deadline; UI wording must not promise successful remote delivery. Recovery must match the observed lease owner, timestamp, and attempt count before updating the job. Only unstarted work may retry under the same run ID. An expired started extraction fails explicitly; its next scheduled/manual attempt uses a fresh run ID/token, preventing old provider results from claiming the replacement attempt. A completed run must not be overwritten by a late worker error.

`vercel.json` schedules daily maintenance. The tick starts up to three worker chains side by side (`WORKER_PARALLEL_CHAINS`), because on the hosting plan a single chain has died after about four hops and left every later source unclaimed for six hours. `.github/workflows/worker-tick.yml` additionally starts a fresh chain every fifteen minutes between 06:00 and 16:00 UTC using the `WORKER_SECRET` and `AI_CALENDAR_WORKER_URL` repository secrets; it sends one request and exits. Worker chaining can process queued work promptly, but if a chain is killed it needs another invocation. For dependable recovery, configure a managed scheduler or dedicated worker to call `POST /api/internal/jobs?limit=1` frequently with `Authorization: Bearer <WORKER_SECRET>`. `WORKER_SECRET` may hold several secrets separated by commas, one per caller, so a collaborator's scheduler gets its own and can be revoked alone; the first listed is the one the app uses to call itself. The fallback secret is `CRON_SECRET`. Check hosting-plan frequency/runtime allowances before changing schedules. Do not use a browser or a model as the scheduler. Monitor queue age, failed runs, callback deadline expiry, and ready-check failures.

`npm run worker:tick -- --help` documents the bounded, independent invocation command. It requires an explicit endpoint and worker secret, does not follow redirects, and prints only counters. It does not install a schedule. Configuration and recovery trials are described in [PILOT-ACCEPTANCE.md](PILOT-ACCEPTANCE.md#independent-worker-operation).

## Publishing and duplicates

Publishing claims serialize on the event row and examine all submissions for the same destination. Changing a payload cannot bypass an unresolved send or create a second post after a successful send. Once sent, editing the local event is not an update to the remote post. A separate reviewer command can PATCH the already-linked numeric CommunityHub post ID at the same destination; it must not change moderation/subscription fields or fall back to creation. Reconcile ambiguous submissions against the destination before retrying. Successful creation and local status are committed together.

An unavailable destination inventory is different from an empty calendar. Extraction records the unavailable check, retains candidates for review, and holds automatic delivery, including later backlog flushes. A reviewer can check the destination and explicitly approve. Shared configured listing URLs are excluded from event-identity matching; their individual events still require content comparison.

## Staging acceptance before deployment

Use a separate MySQL database, test accounts in two communities, and a test destination. Do not run these mutation scenarios against live community events.

1. Bootstrap a new community, complete password setup, sign in, and add a source. Switch to another assigned community and prove the new source belongs there. Check that an unrelated community cannot be read or edited.
2. Enqueue the same source concurrently. Both requests must return the same active run/job. Complete one extraction and compare its timeline, counts, and review queue.
3. Deliver a model response and callback concurrently. Only one may persist candidates. Delay a callback past its deadline and verify it is rejected.
4. Kill a worker, recover its lease, and run overlapping recovery calls. Retry a started extraction with a fresh run ID and deliver the old attempt's callback/output; neither may ingest. A stale owner must not overwrite its replacement. A completed callback must survive a subsequent worker exception.
5. Submit once to the test destination, lose the response, edit the local event, and try again. No second remote post may be created. Verify the published/not-published reconciliation actions.
6. Take the inventory endpoint offline. Candidates must stay reviewable with a visible warning; automatic publishing must remain held even after a no-op save or automated correction.
7. Complete mobile and desktop review, save, reject, approve, and community-switch flows using real database data. Test both success and destination errors.
8. Run a production build, rehearse the schema upgrade, and smoke-test `/api/health/live`, `/api/health/ready`, login, and the accepted public feed after deployment. The reliability/evidence extension has migrations, including a separate historical schema catch-up. Read [PILOT-ACCEPTANCE.md](PILOT-ACCEPTANCE.md) before migrating an existing installation.

The full development dependency audit may report advisories in the legacy esbuild loader used by Drizzle Kit. Track these separately from runtime dependencies; do not apply an automatic downgrade or a breaking migration-tool update just to clear an audit report.
