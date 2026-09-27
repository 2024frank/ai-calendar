# Getting started

This guide takes you from a fresh clone to a running copy of AI Calendar on your own machine, with one community, one admin account, and a first source.

## Prerequisites

| Tool | Version | Notes |
| --- | --- | --- |
| Node.js | 22 or newer | CI runs on Node 22. |
| npm | Bundled with Node | The repo ships a `package-lock.json`; use `npm ci`. |
| MySQL | 8.x | 8.4 is what CI tests against. Any MySQL 8 server works, local or managed. |
| Perplexity API key | — | Only needed to run extraction. The review UI, tests and the synthetic destination work without it. |

Docker is optional. It is a quick way to get a throwaway MySQL:

```bash
docker run -d --name ai-calendar-mysql -p 3306:3306 \
  -e MYSQL_ROOT_PASSWORD=devonly -e MYSQL_DATABASE=ai_calendar_dev mysql:8.4
```

## 1. Install

```bash
git clone https://github.com/2024frank/ai-calendar.git
cd ai-calendar
npm ci
```

## 2. Configure

```bash
cp .env.example .env.local
```

Fill in `.env.local`:

- `DATABASE_*`: point at a **separate development database**. Never point a local copy at production.
- `AUTH_JWT_SECRET`, `AGENT_INGEST_SECRET`, `CRON_SECRET`: generate each one on its own, at least 32 characters:

  ```bash
  openssl rand -hex 32
  ```

- `APP_URL=http://localhost:3000`
- `PERPLEXITY_API_KEY`: add it when you want to run extraction.

Leave the email settings blank. In development, sign-in and password links are printed to the server log instead of being emailed.

Every variable is described in [CONFIGURATION.md](CONFIGURATION.md).

## 3. Create the schema

```bash
npm run db:migrate
```

Migrations live in [`drizzle/`](../drizzle) and are non-destructive. `npm run db:studio` opens Drizzle Studio if you want to browse the tables.

## 4. Create your community and first admin

```bash
npm run seed -- \
  --community-slug your-town \
  --community-name "Your Town" \
  --admin-email admin@example.org \
  --timezone America/New_York
```

This creates one community in human-review mode (`needs_approval`) and a platform admin. Run `npm run seed -- --help` for all options.

## 5. Run it

```bash
npm run dev
```

Open <http://localhost:3000>, enter the admin email, and follow the link printed in the terminal to set a password.

## 6. Add a first source

1. Go to **Sources → Add source**.
2. **Name**: the organization.
3. **Link**: the page (or pages) where it lists events.
4. **Schedule**: how often to check it and how far ahead to look.
5. **Instructions**: copy the generated prompt into ChatGPT or Claude, let it study the site, and paste back the numbered steps it writes. That becomes the source's extraction recipe.
6. Save. The source inherits the community's review mode; keep **Needs approval** while you try things out.
7. Press **Run now** on the source page and watch the run timeline.

New events land in the **Review Queue**. See the [user guide](USER-GUIDE.md) for what each screen does.

## Try publishing without a real destination

`npm run test:destination -- --port 4320` starts a loopback-only, in-memory receiver that accepts marked synthetic submissions. Point a community's destination at it to exercise approve and publish end to end without touching a real calendar. It never forwards anything.

`npm run ui:preview` starts a loopback-only preview of the real interface with synthetic data, no database needed.

## Checks before you open a pull request

```bash
npm run check        # lint, typecheck, unit tests, production build
npm run test:mysql   # real-MySQL isolation suite (needs a disposable database)
```

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| `ECONNREFUSED 127.0.0.1:3306` | MySQL is not running, or `DATABASE_HOST`/`PORT` is wrong. |
| `/api/health/ready` reports config issues | It names each missing or weak setting. In production, secrets must be 32+ characters, `DATABASE_SSL` cannot be `false`, and `APP_URL` must be HTTPS. |
| No sign-in email arrives | Expected in development: copy the link from the server log. |
| Runs fail immediately | `PERPLEXITY_API_KEY` is missing or invalid. The run timeline shows the exact error. |
| "The image host blocks our server" on approve | The image's host refuses server requests. Paste or upload the picture into the Event image box. |

`scripts/rebuild-db.mjs` wipes the database. It is for local resets only and must never be run against a database that holds real data.
