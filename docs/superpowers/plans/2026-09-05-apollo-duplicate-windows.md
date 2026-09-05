# Apollo duplicate windows implementation plan

**Goal:** Prevent a changed Apollo film lineup from being discarded as a duplicate, and recover the confirmed false match without publishing it.

**Spec:** User-approved diagnosis: source 18's Practical Magic 2 announcement 1879 was suppressed against Dog Stars/Coyote announcement 1797 because they share a ticketing URL. Generic title, image and fuzzy-description rules are insufficient for rolling movie announcements.

**Architecture:** Apply a pure, canonical-source-scoped comparison before any generic duplicate shortcut. Require full Apollo candidates, compare announcement kind, film identities and date coverage, and retain full duplicate evidence. Ordinary sources retain their existing behavior. No schema migration or new service is needed.

**Tech stack:** TypeScript, Node test runner, Next.js routes, Drizzle/MySQL.

## Constraints

- Scope to canonical `oberlin/apollo-theater`; do not identify the policy by editable display name.
- No shared URL, poster, title-only marker or fuzzy similarity may override Apollo film/window evidence.
- A candidate window covered by an unchanged existing lineup may duplicate it. New coverage, changed films or incompatible film dates must not.
- Never append Apollo session dates to unchanged stored content.
- Do not approve, publish, delete, or bulk rewrite existing events.
- Keep all source secrets out of output and version control.

## Tasks

- [x] Add failing pure-policy tests, run red, implement `isApolloSource` and `apolloAnnouncementsMatch`, run green. Cover the real false match, changed/subset film lists, same-day generic titles, dates/years, covered rolling windows, malformed evidence and source isolation.
- [x] Add failing ingestion boundary tests for all local/remote/model/hash paths. Integrate the policy in `ingest.ts`, preserve remote event type and session ends in `inventory.ts`, prevent Apollo session merging, and reject incomplete model duplicate markers.
- [x] Clarify the Apollo prompt and require full candidates in `events` with an empty `duplicates` array. Test canonical-source routing and keep generic extraction unchanged.
- [x] Run targeted tests, all tests, lint, typecheck, build and diff checks. Independently review changes and fix regressions.
- [ ] Inspect a safe source-prompt update and targeted duplicate-to-pending repair path. Apply only exact, verified records, with a recoverable before snapshot and no publication; otherwise report the blocker. Do not claim production validation without a deployed run.

## Progress

- Diagnosis verified against run 529 and records 1879/1797. Current checkout starts clean at `3db09bf`.
- Working on `codex/apollo-duplicate-windows` in the user-specified checkout; no separate worktree or shared-branch push performed.
- Saved and reloaded the revised source 18 prompt in the live application. Review mode remains needs approval, with daily checks and a 14-day lookahead. No extraction was triggered.
- Nine real-ingestion regressions: pre-fix code failed eight Apollo cases while the non-Apollo control passed; the implemented code passes all nine. Added remote inventory mapping coverage.
- Independent review found ambiguous short yearless film ranges. Five further regressions failed before the fix and pass after it; implicit endpoint years are now resolved together, including Dec/Jan.
- Final local verification: 267/267 tests pass; lint, typecheck, production build and diff checks pass. This is not a deployed extraction or publication test.
- Live event restoration is blocked. The verified Vercel project export and local environment provide no usable DATABASE_HOST, DATABASE_USERNAME, DATABASE_PASSWORD or DATABASE_NAME. The dry-run repair stopped before connecting or writing. Its temporary environment export was removed.
- The narrow repair helper is dry-run by default and restores only verified event 1879 to pending review with a status-only transaction and audit. It has not been applied. No event was approved, published, deleted or rerun.
- At the implementation handoff, backend changes were local, uncommitted and not deployed. The user subsequently authorized push and production deployment. Track the released commit and deployment status through Git and Vercel; a controlled live extraction and event restoration remain separate verification steps.
