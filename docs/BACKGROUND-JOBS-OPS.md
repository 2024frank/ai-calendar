# Background jobs: operations and options

## How it works today

- Vercel Cron (`vercel.json`, daily 06:00 UTC) calls `GET /api/cron`. It requeues or fails stale jobs, reaps orphan runs, enqueues due sources, and starts up to three worker chains.
- A worker chain is `POST /api/internal/jobs` with `x-ai-calendar-worker-chain: 1`. It returns 202, then in `after()` recovers stale leases, claims one job, and dispatches the next hop. Auth is a bearer matching any comma-separated `WORKER_SECRET` entry (fallback `CRON_SECRET`).
- `.github/workflows/worker-tick.yml` starts a fresh chain at :03/:18/:33/:48 from 06:00 to 15:59 UTC.
- Recovery is safe to repeat: claims and recovery are conditional updates keyed on lease owner, time, and attempt. Unstarted work is requeued under the same run (max attempts 2). Started work is failed explicitly and retried by a new run with a new token. Queued jobs unclaimed for 6 hours are failed. Lease expiry is 15 minutes.

## Gaps found

1. GitHub `schedule` runs are best-effort: delayed or dropped at busy times, and disabled after 60 days without repository activity (public repos). Nothing alerts when that happens.
2. A 202 only means the request was accepted; it does not show that work is moving.
3. No coverage outside 06:00-15:59 UTC. Manual or retried runs queued after that wait for the next morning (or the 6-hour expiry).
4. The last hop of a dead chain is only revived by the next tick, so the real recovery time is the tick interval plus any GitHub delay.

## Changes made (uncommitted)

- Workflow retries transient failures (no response, 429, 5xx) three times, fails on anything but 202, and runs a queue health check afterwards.
- `GET /api/internal/jobs/health` (worker bearer): returns counters and 503 when a job has been unclaimed for more than 90 minutes or a lease is older than 30 minutes (recovery not running).
- Optional `ALERT_WEBHOOK_URL` repository secret: when set, a failed tick posts a Slack-style message with the run link. Unset, it does nothing. GitHub also emails the user who last edited the workflow schedule on every failed run.
- Ticks moved off :00/:15 marks, where GitHub delays are worst.

Deploy order: ship the app first. Until the health route is live the workflow logs a warning on its 404 and carries on.

## Options

| Option | Cost | Reliability | Effort | Notes |
|---|---|---|---|---|
| Keep GitHub Action (with the changes above) | $0 | Medium. Delays/skips; 60-day inactivity disable; alert only on runs that happen | None | Cannot alert on a run that never started |
| Vercel Pro frequent crons | about $20/month | High. Platform scheduler, per-minute possible, longer function limits | Low: edit `vercel.json` | Does not alert by itself; pair with a monitor |
| External free pinger (e.g. cron-job.org or UptimeRobot) | $0 | Medium-high. Independent of GitHub and Vercel; can alert when a call fails or on a missed heartbeat | Low: URL plus header, its own `WORKER_SECRET` entry | Needs a bearer header support; can monitor `/health` too |
| Dedicated worker (small VM or container running `npm run worker:tick` in a loop) | about $5-10/month | High, with full control and no function time limits | High: provisioning, supervision, patching | Overkill at pilot scale |

## Recommendation

Keep the Action as the primary kick, and add a free external pinger as a second, independent caller (its own comma-separated `WORKER_SECRET` entry) that also hits `/api/internal/jobs/health` and emails on failure. This covers the GitHub failure modes at no cost. Move to Vercel Pro if volume grows or the pilot needs a queue-start objective in minutes.

## Founder decisions

- Which channel gets alerts (email only, or a Slack/Discord webhook for `ALERT_WEBHOOK_URL`).
- Whether to extend coverage outside 06:00-15:59 UTC. Each extra hourly run costs about one billed minute; this matters only if the repository is private.
- Whether to pay for Vercel Pro.
