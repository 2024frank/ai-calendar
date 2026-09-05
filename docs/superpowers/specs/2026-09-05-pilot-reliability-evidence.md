# Reliable, measurable community-calendar pilot

User-approved direction: implement the five priorities discussed after reconstructing fourteen April–July meeting transcripts. This increment retains the Next.js/MySQL modular monolith and human-reviewed pilot. The raw meeting archive stays private and outside this repository.

## Deliverables

1. Align source configuration, server lookahead and Apollo policy. A configured lookahead is a hard maximum, including small sources, with ongoing occurrences retained. Apollo's current/upcoming classification must not depend on a gap between films. Preserve complete film/date duplicate evidence and canonical source scoping. Current means a film is already playing at the community-local run date; future opening films are upcoming, including when adjacent to current films. Next-up presentation should not flood the queue with all distant films. Keep source facts and source-specific description rules intact.
2. Distinguish permanent rejection from a reviewer-requested correction. Correction stays review-only, records the request, preserves publication holds, operates on the exact authorized event, and must not silently publish or overwrite an event already sent downstream. Failure remains retryable and visible.
3. Add explicit reviewer-controlled updates to an existing CommunityHub post via the documented PATCH `/api/legacy/calendar/post/{id}/submit` contract. Update only a locally linked, known remote ID at the same destination. Never turn an update into a create. Preserve remote moderation/public state; do not send `public` or subscription fields in the patch. Serialize creates and updates on the event, retain audit and request outcome, and hold ambiguous sends until reconciliation. Additional recurrence dates require review rather than silently modifying a sent record and calling it a duplicate.
4. Add a retained research evaluation: input snapshots, declared source/time scope, independent reference provenance, explicit human-confirmed matches, both unmatched directions, field differences and cautious coverage metrics. A match is a human assertion, not proof supplied by the same duplicate algorithm being evaluated. Empty denominators return unavailable, not perfect scores. Include export and a bounded authenticated UI; no external fetch or publication from research input. Correct operational metric labels and human-approval denominators. Learning failure must not be reported as a successful no-lesson decision.
5. Verify locally with regression tests, typecheck, lint, build and responsive preview. Supply a safe independent worker runner and repeatable staging acceptance instructions, including a fresh second community. Do not claim a reviewer usability trial, measured research result, live queue recovery or live publishing was performed without evidence.

## Constraints

- No production DB changes, extraction calls, publishing, push or deployment in this implementation pass.
- No new runtime dependencies or infrastructure provider.
- No private transcripts, credentials, or copied production records in fixtures.
- Preserve tenant/source authorization, SSRF protections, idempotency and unresolved-delivery holds.
- Schema changes must be additive, generated/reviewed, and not applied to a live database.
- Keep existing CSS/component conventions and light/dark/mobile accessibility.
- Each behavior change requires an observed failing regression and a passing implementation.

## Acceptance

Fixtures must distinguish changed film lineups from exact duplicates; adjacent future openings from current films; ongoing events from out-of-horizon starts; permanent rejection from correction; remote update from re-create; ambiguous update from safe retry; manual approval from automatic delivery; actual reference coverage from unmatched candidates. Staging and human trials remain explicitly separate release gates.
