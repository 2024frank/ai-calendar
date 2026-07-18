# AI Calendar

A multi-tenant platform that finds community events on the open web and files them into a review queue, or publishes them straight to a community calendar.

Built for [CommunityHub](https://www.communityhub.cloud/) communities. Oberlin and Cleveland run on it today.

## What it does

You give it a **source** (a name and a link). Two agents take it from there:

1. **Discovery Agent** probes the site once and works out the cheapest reliable way to read its events, preferring a public JSON API, then an iCal or RSS feed, then JSON-LD markup, and only falling back to parsing HTML. It writes a durable extraction recipe for that source.
2. **Source Agent** replays that recipe on a schedule, returning normalized events.

Every event is deterministically validated and deduplicated by content (date and location first), then routed by the source's **mode**:

- `restricted` (default): the event waits in a human review queue.
- `unrestricted`: clean, non-duplicate events publish automatically.

Approved events always land in the community's own **AI calendar**, and are additionally pushed to an external **destination** (such as CommunityHub) when one is configured. With no destination, the AI calendar is the whole story.

## Why the runs are observable

Agent runs are not a black box. Every step is persisted and streamed to a live timeline: each fetch and its size, each model turn and its token usage, every candidate validated, every dedup decision and its reason, and where each event ended up. A run always reaches a definite terminal state, so nothing ever looks stuck forever.

## Architecture

| Concept | Meaning |
| --- | --- |
| **Community** | A tenant. Owns sources, users, an AI calendar, and an optional destination. |
| **Source** | Where events come from. A website or an email inbox. |
| **Destination** | Optional external target (`communityhub`, `webhook`, `ical`). |
| **Mode** | `restricted` (review first) or `unrestricted` (publish directly). |
| **Run** | One agent execution, with a persisted step-by-step trail. |
| **Rule** | A durable correction learned from reviewer edits, injected into later runs. |

Roles are `platform_admin` (all communities), `community_admin` (one community; adds reviewers, sources, and the destination), and `reviewer` (works the queue for assigned sources).

## Stack

Next.js (App Router) and TypeScript, Drizzle ORM on MySQL 8, and the Anthropic API for the agents. Authentication is passwordless email sign-in with a JWT session cookie. Deployed on Vercel.

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in your values
npm run db:generate          # generate SQL from the Drizzle schema
node scripts/rebuild-db.mjs  # create the schema (destructive: drops existing tables)
node scripts/seed-db.mjs     # seed communities, destination, admin user
npm run dev
```

### Environment

| Variable | Purpose |
| --- | --- |
| `DATABASE_HOST` / `PORT` / `USERNAME` / `PASSWORD` / `NAME` | Application MySQL database |
| `ANTHROPIC_API_KEY` | Runs the Discovery and Source agents |
| `AUTH_JWT_SECRET` | Signs the session cookie |
| `APP_URL` | Public base URL, used in sign-in links |
| `RESEND_API_KEY`, `EMAIL_FROM` | Optional. Without it, sign-in links are logged instead of emailed |
| `CH_DB_*` | Optional read-only CommunityHub database, used for duplicate checking |
| `PLATFORM_ADMIN_EMAILS` | Seeded platform administrators |

### Useful scripts

```bash
node scripts/inspect-db.mjs                     # tables and row counts
node scripts/backup-db.mjs                      # full JSON backup
node scripts/show-events.mjs                    # inspect extracted events
node scripts/mint-login.mjs you@example.org     # print a sign-in link (no email needed)
node scripts/set-source-url.mjs <slug> <url>    # point a source at its events page
```

## Event quality rules

Extraction enforces a fixed contract rather than trusting free-form model output. Among other rules: announcement titles must be action oriented, a registration URL forces "Registration required." onto the short description and must never be buried in the long description, long descriptions may not contain URLs or street addresses, categories must come from the destination's real taxonomy, and duplicates are preserved for evaluation instead of being silently dropped.

## License

MIT. See [LICENSE](LICENSE).
