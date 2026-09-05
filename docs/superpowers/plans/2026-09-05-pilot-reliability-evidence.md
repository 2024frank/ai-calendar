# Pilot reliability and research evidence implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development with test-first changes and independent review.

**Goal:** Make the existing human-reviewed pilot's rules, event lifecycle and research claims consistent and testable.

**Architecture:** Extend the existing application with small policy helpers, explicit commands and retained evaluation snapshots. Preserve the event-locked outbox and scoped access. Keep live execution outside local validation.

**Tech Stack:** TypeScript, Next.js, React, Drizzle/MySQL, Node test runner.

**Spec:** `docs/superpowers/specs/2026-09-05-pilot-reliability-evidence.md`

## Global Constraints

- No production DB changes, extraction calls, publishing, push or deployment in this implementation pass.
- No new runtime dependencies or infrastructure provider.
- No private transcripts, credentials, or copied production records in fixtures.
- Preserve tenant/source authorization, SSRF protections, idempotency and unresolved-delivery holds.
- Schema changes must be additive, generated/reviewed, and not applied to a live database.
- Keep existing CSS/component conventions and light/dark/mobile accessibility.
- Each behavior change requires an observed failing regression and a passing implementation.

## Task 1: Source policy and lookahead

**Files:** `src/lib/apolloInstructions.ts`, `src/lib/sources/apolloSegments.ts`, `src/lib/contract.ts`, `src/app/(app)/sources/new/NewSourceForm.tsx`, relevant policy tests.

**Produces:** unchanged public segmenter signature with corrected current/upcoming output; authoritative Apollo policy precedes saved conflicting instructions. No schema changes.

- [x] Write a hand-checked film fixture: run Sep 5, current film through Sep 9, next film Sep 10–12. Assert next film is coming-soon despite adjacent dates, no future-only film is in the current lineup, current content survives, and sequel digits remain significant. Cover closed-day, empty schedule and year transitions.
- [x] Run tests red against real segmenter, correct the policy, and run green.
- [x] Align saved-source prompt composition and UI lookahead description with server behavior; retain canonical-source boundary and full-candidate duplicate checks.

## Task 2: Reviewer lifecycle and safe downstream updates

**Files:** `src/lib/publishClaim.ts`, `src/lib/publishEvent.ts`, new `src/lib/publishUpdate.ts`, review command routes/UI, `src/lib/ingest.ts`, new correction-request route/helper, related tests. Schema extension coordinated with controller if needed.

**Produces:** explicit authenticated correction and update commands, no automatic network writes; sent-record new-occurrence proposals stay visible for review.

- [x] Add real route/claim regressions for unauthenticated and foreign-community access, missing remote ID, unchanged updates, ambiguous delivery, concurrent create/update, failed versus successful PATCH, and request-correction versus permanent rejection.
- [x] Watch failures; implement the narrow commands using existing request-size validation, public URL pinning and event-row locking.
- [x] PATCH only content to the destination-linked remote ID. Keep moderation fields absent. Persist ambiguous outcomes and block re-create/retry until reconciliation.
- [x] New dates on sent local events must remain an explicit review proposal. No silent local merge of already-sent records.
- [x] Add distinct UI actions with confirmation, busy/error state, and truthful result messages. Run targeted regressions and typecheck.

## Task 3: Retained research comparison and honest metrics

**Files:** new `src/lib/evaluation.ts`, new evaluation API/page/UI, `src/db/schema.ts` additive evaluation table, `src/lib/metrics.ts`, metrics/learning UI, `src/lib/learningAgent.ts`, tests.

**Produces:** validated, versioned evaluation JSON and deterministic report from immutable uploaded snapshots and explicit matches. Only this task owns schema edits; coordinate requested outbox columns with task 2.

- [x] Test hand-labelled snapshots: reference A/B, extracted A/C, confirmed match A/A. Expect reference-only B, extracted-only C, 50% reference coverage, exact field differences, and null metrics for empty reference. Reject duplicate IDs, many-to-one matches, out-of-scope dates, missing provenance and oversized input.
- [x] Implement validation/reporting without fetching URLs, running models or changing events. Retain snapshots plus creator, community/source, period, provenance and capture time. Limit documents and rows so the browser and DB remain bounded.
- [x] Add scoped authenticated create/list/detail/export routes and an admin evaluation page using existing components. Require human confirmation of matches and scope; unmatched candidates are not automatically false positives.
- [x] Correct metrics: only reviewer-approved records count as human approvals; current completeness is labelled as current, not immutable arrival accuracy. Keep time saved explicitly estimated.
- [x] Learning-provider failure closes the run as failed with visible retry context, not 'nothing worth teaching'. Add regression coverage. No fine-tuning or learning-effectiveness claims.

## Task 4: Operations, migration and acceptance

**Files:** safe worker runner script/tests, additive Drizzle migration, docs/RELIABILITY.md, README.md, preview fixtures as necessary.

- [x] Add a bounded independent worker invocation script with required explicit URL/secret, no secret output, and import-safe testable argument/response handling. Do not execute against production or install a schedule.
- [x] Generate the additive schema migration locally and inspect SQL for unrelated destructive changes. Do not migrate production.
- [x] Run targeted regressions, full tests, lint, typecheck, build and diff checks. Review each task and the combined diff.
- [x] Run the local synthetic preview for desktop/mobile and document the separate MySQL/test-destination acceptance scenarios, fresh-community onboarding, measured research trial and scheduler deployment gates.

## Progress / decisions

- Baseline: clean checkout at 468ad08; preceding fresh suite 267/267 passing. Working branch `codex/pilot-reliability-evidence` in the supplied checkout; no separate worktree created without a user preference.
- User approved implementation of the preceding five-priority design. Local implementation is authorized; live pilot trials and rollout are not treated as already completed.
- Independent tasks use disjoint ownership; schema and final integration are coordinated explicitly. Review and local acceptance follow implementation.
- Local implementation verified on September 5: `npm run check` passed (387 tests, lint, typecheck, production build); runtime audit reported zero vulnerabilities; Drizzle metadata and whitespace checks passed. Independent reviews addressed endpoint provenance, ambiguous acknowledgments, correction leases, JSON key-order comparison, proposal retention/resolution, creator attribution, and metric denominators.
- Added a separate 12-case MySQL integration suite and disposable CI service. **Not executed locally:** Docker did not respond. Fast route tests use isolated adapters and do not prove MySQL locking semantics. No CI run, migration application, model extraction, CommunityHub write, scheduler installation, or human trial was performed. See `docs/PILOT-ACCEPTANCE.md` for these release gates.
- Subsequent user-authorized follow-up restarted Docker and added an isolated synthetic HTTP receiver. Actual MySQL 8.4.11 verification exposed and fixed historical `0001` timestamp update precision; **16/16 real MySQL/HTTP tests now pass**, superseding the earlier database blocker. Final local `npm run check` passed 395 tests plus lint/typecheck/build; audit and metadata checks passed. Production-restored migration rehearsal, live provider compatibility and human/scaling trials remain separate. See the follow-up record in `docs/PILOT-ACCEPTANCE.md`.
