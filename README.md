# AI Calendar

In a town like Oberlin, there is always something happening: a concert at the Conservatory, a show at the Apollo, storytime at the library, a workshop at FAVA. The problem is that no one place lists all of it. Every organization keeps its own calendar, on its own website, in its own format, and almost none of them cross-post. To actually know what is going on that week, you would have to check a dozen sites, and most people never do. Events get missed, and the town feels less connected than it is.

## Why this exists

More than a decade ago, at the request of the Oberlin Business Partnership, the Environmental Dashboard team built a shared Community Calendar so any organization or resident could submit an event through one simple form. Approved events show up on websites, on 23 Community Dashboard signs around town, and in a weekly newsletter ([environmentaldashboard.org/calendar](https://www.environmentaldashboard.org/calendar)). It works, but it still depends on people remembering to post, and the many separate calendars around town stay separate.

The Environmental Dashboard is the work of **Professor John Petersen**, Paul Sears Professor of Environmental Studies and Biology at Oberlin College and the project's founder. His question was a civic one: a community stays connected only when people can actually find out what is going on in it, and shared information is part of the infrastructure that holds a place together.

This project is a pilot, funded by an AI micro-grant and built by Frank Kusi Appiah with Professor Petersen, that asks whether today's AI can do the part people were never going to keep up with by hand: read all those scattered calendars, pull the events into one place, and hand them to a person to approve. If it works here, the same approach extends to the Dashboard's work in MidTown Cleveland and other neighborhoods, where one sign is meant to blend hyper-local news with content at the ward, city, county, and regional level. So this is not really a calendar project. It is an experiment in whether AI can strengthen the shared information a community runs on.

## How it works

You add a **source** (an org and its events page) through a short wizard: name, link, how often to check, how far ahead to look. The last step gives you a prompt to paste into ChatGPT or Claude. That model looks at the site and writes a short recipe for pulling events off it, which you save as the source's instructions.

After that, on a schedule, an agent runs the recipe. It has a sandbox to run curl and Python in, so it can fetch pages, hit APIs, and get past sites that block plain requests (a lot of them sit behind Cloudflare). It pulls the upcoming events, checks them against what's already on the calendar so it doesn't post the same thing twice, and hands them back.

Every event then gets checked by the server for the boring stuff: it has a date, an image, a contact, a real description, and so on. Anything missing is flagged for the reviewer or dropped. What survives goes to the review queue, or straight to the calendar if the source is set to publish automatically.

That's the whole loop. Add a source once, and it keeps itself up to date.

## Some things it handles

- A play running six nights is one event with six dates, not six copies.
- A weekly class is one event, not one per week.
- Images that live behind a bot wall get downloaded by the agent and sent along as data, since the server can't reach them.
- Duplicates are judged by what the event actually is, not by matching strings, and each one links to the version it matched so a reviewer can check.
- Events delete themselves once they're over, so the calendar only holds what's coming up.
- Every event links back to the exact page it came from, and an event whose source link is dead gets dropped, since a fabricated link usually means a fabricated event.
- Every run is written down step by step (each fetch, each model call, each decision) and shown on a live timeline, so a run never just hangs with no explanation.

It is multi-tenant: one install serves several communities, each with its own sources, calendar, and destination. A person can belong to more than one and switch between them.

An admin can pick which AI model runs extraction for every source (Claude, Gemini, or GPT) and change it in one place. Each run records its real dollar cost, straight from what the API bills, so a metrics view can show total spend, cost per event, and a side-by-side comparison of how each model performs and what it costs. Along with how many events were gathered, how many reposts were caught, and how much a reviewer still had to correct, that is the kind of thing a pilot needs to show whether the approach works and what it costs to run.

## Words the code uses

| Word | Means |
| --- | --- |
| Community | One tenant. Has its own sources, users, calendar, and destination. |
| Source | Where events come from. Usually a website. |
| Destination | Where approved events get pushed, like CommunityHub. Optional. |
| Mode | `restricted` (a person reviews first) or `unrestricted` (publish on its own). |
| Run | One execution of the agent against a source, with its full trail saved. |

Three roles: platform admin (everything), community admin (their own community), reviewer (works the queue).

## Stack

Next.js and TypeScript, Drizzle on MySQL, and the [Perplexity Agent API](https://docs.perplexity.ai/docs/agent-api) for the agent (it runs Claude and other models in a managed sandbox). Sign-in is a passwordless email link. Runs on Vercel with a daily cron for the scheduled checks and cleanup.

## Running it locally

```bash
npm install
cp .env.example .env.local   # fill in your values
npm run db:generate
node scripts/rebuild-db.mjs   # builds the schema; drops existing tables first
node scripts/seed-db.mjs      # first community, destination, admin user
npm run dev
```

### Environment

| Variable | For |
| --- | --- |
| `DATABASE_HOST` / `PORT` / `USERNAME` / `PASSWORD` / `NAME` | The app's MySQL database |
| `PERPLEXITY_API_KEY` | The extraction agent |
| `AUTH_JWT_SECRET` | Signing the session cookie |
| `AGENT_INGEST_SECRET` | Signing the token an agent uses to post results back |
| `CRON_SECRET` | Authorizes the daily cron |
| `APP_URL` | Public base URL, used in sign-in links |
| `RESEND_API_KEY`, `EMAIL_FROM` | Optional. Without them, sign-in links get logged instead of emailed |
| `CH_DB_*` | Optional read-only CommunityHub database for duplicate checks |
| `PLATFORM_ADMIN_EMAILS` | Who gets seeded as a platform admin |

## License

MIT. See [LICENSE](LICENSE).
