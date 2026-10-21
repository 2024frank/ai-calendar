# Archived scripts

One-off and historical scripts from the Oberlin pilot, moved here with `git mv` (history preserved). They are **not supported tooling**: they assume the pilot's data (hard-coded source ids, slugs, URLs, emails), most read `.env.local` and connect straight to whatever `DATABASE_*` points at, and none are covered by tests or CI. Relative import and `.env` paths were updated for the new depth, so they still resolve. Do not run one without reading it and taking a backup.

The scripts below are excluded from ESLint (`eslint.config.mjs`). The legacy-import ones also need `@anthropic-ai/sdk`, which was removed from `package.json` because no live code uses it (`npm i -D @anthropic-ai/sdk` to revive them).

Legend: **[DDL]** changed the schema outside migrations; **[WRITE]** inserts, updates or deletes data; **[API]** calls the app's HTTP API with a minted credential; no flag means read-only.

## Schema changes made outside migrations
| Script | Purpose |
|---|---|
| add-columns.mjs **[DDL]** | Added `events.place_name`, `room_num`, `geo_scope` (now in migration 0001). |
| add-image-data.mjs **[DDL]** | Added `events.image_data` as MEDIUMTEXT (migration 0001 / schema.ts say `text`: see drift note). |
| add-ingested-url.mjs **[DDL][WRITE]** | Added `events.ingested_post_url`, rewrote localhost image URLs, backfilled review deep links to the production host. |
| add-password-columns.mjs **[DDL]** | Added `users.password_hash`, `users.must_set_password` (now in 0001). |
| add-user-communities.mjs **[DDL][WRITE]** | Created `user_communities` (FK names `fk_uc_*`, differ from 0001) and seeded memberships. |
| add-film-runs.mjs **[DDL]** | Created `apollo_film_runs`. **Not in any migration or schema.ts, but `src/lib/sources/apolloTracking.ts` uses it.** |

## Data-mutating (no migration)
| Script | Purpose |
|---|---|
| apollo-instr.mjs **[WRITE]** | Set special instructions on source 18. |
| backfill-expiry.mjs **[WRITE]** | Recomputed event expiry from sessions (`--write` to apply). |
| dedupe-apollo.mjs **[WRITE]** | Deleted all but the newest Apollo event per title. |
| del-source-events.mjs **[WRITE]** | Deleted all events for given source ids. |
| del-user.mjs **[WRITE]** | Deleted users by email. |
| fill-org-contacts.mjs **[WRITE]** | Scraped org contact details from source sites and updated sources (`apply`). |
| fix-apollo.mjs, fix-college.mjs, fix-college-url.mjs **[WRITE]** | Rewrote URL, start URLs, instructions and recipe for Apollo (source 1) and the college source (id 2). |
| fix-fixedevents.mjs, fix-special.mjs, note-blocked.mjs **[WRITE]** | Deactivated or annotated specific sources by id (3; 14; 4, 11, 14). |
| import-legacy.mjs **[WRITE]** | Imported legacy agent prompts and URLs into sources (`apply`). |
| mark-orphans.mjs **[WRITE]** | Marked `running` runs as failed after a server reload. |
| mint-login.mjs, mint-setpw.mjs **[WRITE]** | Inserted magic-link / 7-day OTP `login_tokens` for a hard-coded personal email and the production URL. Security-sensitive. |
| mint-cookie.mjs | Signed a 7-day session JWT with `AUTH_JWT_SECRET` for any user (no DB write). Security-sensitive; used by the [API] runners. |
| reclassify.mjs, rename-apollo.mjs, rename-apollo2.mjs **[WRITE]** | Auto-rejected incomplete pending events; renamed Apollo event titles. |
| reset-sources.mjs **[WRITE]** | Reset discovery status on given sources. |
| wipe-sources.mjs **[WRITE]**, setup-apollo.mjs **[WRITE]** | **Destructive**: `DELETE FROM` publish_submissions, events, run_events, runs, (apollo_film_runs) and sources, then (setup-apollo) recreate the Apollo source. |
| restore-legacy-prompts.mjs **[WRITE]** | Restored legacy prompts into `special_instructions`. |
| run-all.mjs **[WRITE][API]**, run-subset.mjs **[API]** | Triggered discover and run for every or some sources against localhost; run-all also deleted older events. |
| seed-db.mjs **[WRITE]** | Historical Oberlin community, destination, source and user seed (hard-coded scratchpad path). Superseded by `npm run seed`. |
| set-contacts.mjs, set-role.mjs, set-source-url.mjs, set-special.mjs **[WRITE]** | Set contacts, a user role, a source URL, or special instructions (by id or name). |

## Read-only diagnostics and experiments
| Script | Purpose |
|---|---|
| analysis, check-apollo, flagged-event, img-distinct, inspect-db, legacy-state, legacy-urls, list-sources, one-event, reject-reasons, show-events, show-learning, show-legacy, user-state, verify-db | Ad-hoc SELECT reports on sources, events, learnings and destinations (inspect-db also read the CommunityHub DB). |
| peek-agent, peek-apollo, peek-comm, peek-dest, peek-fava, peek-images, peek-links, peek-run, peek-tracking, peek18 | Quick looks at one source, run or table. |
| poll-run, run-events, run-status, watch-run, watch-source | Tail a run's status or events. |
| backup-db.mjs | Dumps every table to a JSON file in a hard-coded scratchpad path. Read-only on the DB. |
| probe-contacts, sandbox-probe, test-apollo.mts, demo-segments.mts, test-time, test-webfetch, test-webfetch2, veezi-truth | Experiments with fetching, Veezi segments and time parsing. |
