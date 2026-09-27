# Configuration

AI Calendar reads all configuration from environment variables. Locally, put them in `.env.local` (start from [`.env.example`](../.env.example)). In production, set them in your host's secret store. Never commit a filled-in env file; `.gitignore` excludes every `.env*` file except the example.

`GET /api/health/ready` reports which required settings are missing or too weak, by name only, so it is safe to call from monitoring.

## Required

| Variable | Purpose |
| --- | --- |
| `DATABASE_HOST` | MySQL host. |
| `DATABASE_PORT` | MySQL port. Defaults to `25060` (DigitalOcean managed MySQL), so set `3306` for a local server. |
| `DATABASE_USERNAME` | MySQL user. |
| `DATABASE_PASSWORD` | MySQL password. |
| `DATABASE_NAME` | Database name. Use a separate one for development. |
| `APP_URL` | Public base URL, e.g. `https://calendar.example.org`. Used in sign-in links, reviewer record links and the agent's callback URL. Must be HTTPS in production. |
| `AUTH_JWT_SECRET` | Signs the session cookie. 32+ characters. |
| `AGENT_INGEST_SECRET` | Signs the per-run callback tokens handed to the extraction agent and the short-lived image-publish tokens. The secret itself is never sent to a model. 32+ characters. |
| `CRON_SECRET` | Bearer secret for `/api/cron`. 32+ characters. |
| `PERPLEXITY_API_KEY` | The [Perplexity Agent API](https://docs.perplexity.ai/docs/agent-api), which runs the extraction, correction and learning agents in a managed sandbox. |

Generate each secret independently:

```bash
openssl rand -hex 32
```

## Workers

| Variable | Purpose |
| --- | --- |
| `WORKER_SECRET` | Bearer secret(s) for `/api/internal/jobs`. Comma-separated to give each caller its own secret so any one can be revoked alone; the first is used when the app dispatches itself. Falls back to `CRON_SECRET` when unset. |
| `AI_CALENDAR_WORKER_URL` | Full `/api/internal/jobs` URL. Read only by the independent runner (`npm run worker:tick`) and the **Worker tick** GitHub workflow, not by the app. |

## Database

| Variable | Purpose |
| --- | --- |
| `DATABASE_SSL` | `true` to require TLS. Cannot be `false` in production. |
| `DATABASE_CA_CERT` | PEM CA certificate for managed MySQL. Required for DigitalOcean managed databases. |
| `DB_POOL_SIZE` | Connections per process. Defaults to `3`; keep it small on serverless hosts. |

## Email

The app sends four emails: sign-in link, password set/reset, community invite, and a reviewer digest after a run brings in new events.

| Variable | Purpose |
| --- | --- |
| `HOSTINGER_EMAIL`, `HOSTINGER_EMAIL_PASSWORD` | SMTP mailbox the app sends from. Any SMTP mailbox works; the name reflects the original deployment. |
| `HOSTINGER_SMTP_HOST`, `HOSTINGER_SMTP_PORT` | Override the SMTP host and port. |
| `RESEND_API_KEY`, `EMAIL_FROM` | Optional [Resend](https://resend.com) fallback, used when the mailbox is unset or refuses. |

With no provider configured, development prints links to the server log instead.

## Publishing

| Variable | Purpose |
| --- | --- |
| `PUBLISH_EMAIL` | The email sent as the publishing identity in every destination payload. |

The destination itself (for example a CommunityHub endpoint) is configured per community in the app, under **Communities**, not in the environment.

## Source-specific

| Variable | Purpose |
| --- | --- |
| `APOLLO_VEEZI_API_TOKEN` | Optional. Lets the Apollo Theatre source read showtimes from the Veezi API instead of scraping. Other deployments can leave it unset. |

## Scheduling

[`vercel.json`](../vercel.json) schedules `/api/cron` once a day at 06:00 UTC. That tick enqueues due sources, runs retention, and recovers stale jobs. For faster queue recovery, call `/api/internal/jobs` more often; see [DEPLOYMENT.md](DEPLOYMENT.md#workers-and-scheduling).

The AI model used for extraction is chosen by a platform admin on the **Pilot Metrics** page, not in the environment. The chosen model runs first and the others act as fallbacks.
