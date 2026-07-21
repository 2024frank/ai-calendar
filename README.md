# AI Calendar

A multi-tenant platform that finds community events on the open web and files them into a review queue, or publishes them straight to a community calendar.

Built for [CommunityHub](https://www.communityhub.cloud/) communities. Oberlin and Cleveland run on it today.

## What it does

You add a **source** through a short setup wizard: name, link, how often to check, and how far ahead to look. The wizard hands you a research prompt to paste into ChatGPT or Claude; that model studies the site and returns a short, specific extraction recipe you save as the source's instructions. From then on:

1. On a schedule, an **extraction agent** runs with its own sandbox (curl and Python), URL fetching, and web search. It replays the recipe, reads both the community calendar and the destination to avoid reposting, and returns normalized events. Bot-walled sites (Cloudflare, WAFs) are read with a full browser-fingerprint request; images behind blocked hosts are shipped inline as base64.
2. The agent judges duplicates by **meaning** across both inventories, not by string equality, and reports each match with a link so a reviewer can confirm it.

Every event is also deterministically validated on the server (required fields, one image each, contacts, no links in descriptions, sane dates) and deduplicated as a safety net, then routed by the source's **mode**:

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

Next.js (App Router) and TypeScript, Drizzle ORM on MySQL 8, and the [Perplexity Agent API](https://docs.perplexity.ai/docs/agent-api) (running Claude and other frontier models in a managed sandbox) for the agents. Authentication is passwordless email sign-in with a JWT session cookie. Deployed on Vercel, with a daily cron for scheduled runs and retention.

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
