# Deployment

The reference deployment is **Next.js on Vercel** with **managed MySQL** (DigitalOcean). Nothing in the app is Vercel-specific apart from `vercel.json` and the use of `after()` to start work right after a request, so any Node host that can run `next start` works.

For the production topology, reliability model and scaling path, read [ARCHITECTURE.md](ARCHITECTURE.md). This page is the practical checklist.

## Checklist

1. **Provision MySQL 8** with TLS. Create a database and a user limited to it.
2. **Set environment variables** from [CONFIGURATION.md](CONFIGURATION.md). In production:
   - every secret is independent and at least 32 characters,
   - `DATABASE_SSL=true` (and `DATABASE_CA_CERT` when the provider requires it),
   - `APP_URL` is the public HTTPS origin.
3. **Migrate** from a trusted machine or a release step:

   ```bash
   npm ci
   npm run db:migrate
   ```

   Take a snapshot or `mysqldump` first. Migrations are additive; never run `scripts/rebuild-db.mjs` against a real database.
4. **Bootstrap** the first community and admin once: `npm run seed -- --help`.
5. **Deploy** the app (`npm run build`, `npm start`, or push to Vercel).
6. **Check readiness**: `GET /api/health/live` should return 200 and `GET /api/health/ready` should report no issues.
7. **Configure a destination** per community under **Communities**, and set `PUBLISH_EMAIL`.
8. **Schedule the workers** (below).

## Workers and scheduling

Extraction runs as durable jobs in the `jobs` table. The web process enqueues a job, commits it, then starts it right away. If that invocation dies, the job is still in the table and the next drain picks it up.

Two entry points drain the queue:

| Endpoint | Auth | What it does |
| --- | --- | --- |
| `GET /api/cron` | `Authorization: Bearer $CRON_SECRET` | Enqueues sources that are due, sweeps finished events, closes stale runs, requeues stale jobs. |
| `POST /api/internal/jobs?limit=2` | `Authorization: Bearer <one of WORKER_SECRET>` | Recovers and runs up to `limit` queued jobs. |

`vercel.json` calls `/api/cron` daily at 06:00 UTC. A daily tick alone is too slow to recover a worker chain that died mid-queue, so this repository also runs the **Worker tick** GitHub workflow ([`.github/workflows/worker-tick.yml`](../.github/workflows/worker-tick.yml)) every 15 minutes through the morning. It only runs on the upstream repository; in a fork, either edit its `if:` guard and add the `WORKER_SECRET` and `AI_CALENDAR_WORKER_URL` repository secrets, or use any other scheduler:

```bash
AI_CALENDAR_WORKER_URL=https://calendar.example.org/api/internal/jobs \
WORKER_SECRET=... npm run worker:tick
```

Give each scheduler its own secret in the comma-separated `WORKER_SECRET` list so you can revoke one without rotating the others.

## Security notes

- Secrets are only ever read from the environment. The agent receives a per-run HMAC token, never a signing secret.
- Sessions are signed cookies (`AUTH_JWT_SECRET`). Rotating that secret signs everyone out.
- Authentication endpoints are rate limited across the fleet through `rate_limit_buckets`.
- Every private API derives the tenant from the session. See [ARCHITECTURE.md → Security and tenant isolation](ARCHITECTURE.md#security-and-tenant-isolation).

## Upgrading

```bash
git pull
npm ci
npm run check
npm run db:migrate   # after a backup
```

Then deploy. [RELIABILITY.md](RELIABILITY.md) lists the staging checks to run before a release, and [PILOT-ACCEPTANCE.md](PILOT-ACCEPTANCE.md) records how existing databases were upgraded.
