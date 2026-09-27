# HTTP API

All endpoints are served by the Next.js app under `/api`. Responses are JSON unless noted. Conventions and the planned error envelope are in [ARCHITECTURE.md → API design](ARCHITECTURE.md#api-design).

There are four kinds of caller:

| Caller | Auth |
| --- | --- |
| Anyone | None. Only the public feed, event images of accepted events, and health checks. |
| Signed-in users | Session cookie set by `/api/auth/*`. The community always comes from the session, never from the request. |
| The extraction agent | Per-run HMAC token issued for one live run. |
| Schedulers and workers | `Authorization: Bearer` with `CRON_SECRET` or one of `WORKER_SECRET`. |

## Public event feed

```
GET /api/v1/events
```

A read-only feed of accepted and published events. It never exposes the review queue, rejected records, run internals or reviewer identities. `/api/public/events` is the older alias for the same handler and stays available while consumers migrate.

| Parameter | Meaning |
| --- | --- |
| `status` | `approved`, `submitted`, `published`, a comma-separated list of them, or `all`. Default: all three. |
| `community` | Community id or slug. Unknown or suspended communities return `404`. |
| `source` | Source id. |
| `from` | ISO date. Only events with a session starting at or after it. |
| `upcoming` | `true` hides events whose last session has passed. |
| `q` | Text match on title or location (first 200 characters). |
| `limit` | 1–500, default 100. |
| `offset` | 0–10000, default 0. |

Results are ordered by each event's latest session, newest first.

```bash
curl 'https://calendar.example.org/api/v1/events?community=oberlin&upcoming=true&limit=20'
```

```json
{
  "total": 42,
  "limit": 20,
  "offset": 0,
  "events": [
    {
      "id": 2411,
      "status": "published",
      "eventType": "ot",
      "title": "Fall Treasure Fest",
      "description": "Antiques, vintage wares and food trucks downtown.",
      "extendedDescription": "…",
      "sessions": [{ "startTime": 1791640800, "endTime": 1791662400 }],
      "locationType": "ph2",
      "location": "Downtown Oberlin, OH",
      "placeName": null,
      "roomNum": null,
      "urlLink": null,
      "postTypeIds": [7],
      "sponsors": ["Oberlin Business Partnership"],
      "website": "https://…",
      "registrationUrl": null,
      "imageCdnUrl": "https://…/api/events/2411/image.jpg",
      "contactEmail": "director@example.org",
      "phone": "440-555-0100",
      "calendarSourceName": "Oberlin Business Partnership",
      "calendarSourceUrl": "https://…",
      "createdAt": "2026-09-20T14:03:11.000Z",
      "sourceName": "Oberlin Business Partnership",
      "communitySlug": "oberlin"
    }
  ]
}
```

`sessions[].startTime` and `endTime` are Unix seconds. `locationType` is `ph2` (in person), `on` (online) or `bo` (both). `eventType` and `postTypeIds` follow the CommunityHub taxonomy in [`src/lib/taxonomy.ts`](../src/lib/taxonomy.ts).

`GET /api/events/:id/image.jpg` serves an event's stored image publicly once the event is approved, submitted or published.

## Health

| Endpoint | Returns |
| --- | --- |
| `GET /api/health/live` | 200 while the process is up. |
| `GET /api/health/ready` | Database reachability and the names of any missing or weak settings. |

## Scheduler and worker

| Endpoint | Auth | Purpose |
| --- | --- | --- |
| `GET`/`POST /api/cron` | `Bearer $CRON_SECRET` | Enqueue due sources, sweep finished events, close stale runs, requeue stale jobs. |
| `POST /api/internal/jobs?limit=2` | `Bearer <WORKER_SECRET entry>` | Recover and run queued extraction jobs. |

See [DEPLOYMENT.md → Workers and scheduling](DEPLOYMENT.md#workers-and-scheduling).

## Agent callback

| Endpoint | Purpose |
| --- | --- |
| `POST /api/agent/ingest` | The extraction agent posts candidate events here, bounded per run and authenticated with the run's HMAC token. |
| `GET /api/v1/events?status=pending&runId=…&token=…` | Lets a live run see the review queue so it can judge duplicates. The token only works while that run is running, and only for its own community. |

The contract the agent must follow is defined in [`src/lib/contract.ts`](../src/lib/contract.ts).

## Session API (used by the app)

These endpoints back the web interface. They are stable enough to script against with a session cookie, but they are not a versioned public contract.

| Area | Endpoints |
| --- | --- |
| Auth | `POST /api/auth/login`, `/request` (email link), `/forgot`, `/set-password`, `/logout`; `GET /api/auth/verify` |
| Communities | `PATCH /api/communities/:id`, `PUT /api/communities/:id/endpoint` (destination), `POST /api/communities/switch` |
| Sources | `GET`/`POST /api/sources`, `PATCH /api/sources/:id`, `POST /api/sources/:id/run` (returns `runId`, `jobId`) |
| Runs | `GET /api/runs/:id/events?after=` (incremental timeline) |
| Events | `GET`/`PATCH /api/events/:id`; `POST …/approve`, `…/reject`, `…/request-correction`, `…/update-published`, `…/resolve-proposal`, `…/reconcile-publish`, `…/image` (upload); `POST /api/events/recheck-destination`; `GET /api/pending-count` |
| Corrections | `GET`/`POST /api/corrections/next` (admin: work the correction backlog) |
| Learning | `PATCH /api/learnings/:id` (`active` / `retired`), `GET /api/learnings/export` |
| Evaluations | `GET`/`POST /api/evaluations`, `GET /api/evaluations/:id`, `GET /api/evaluations/draft` |
| Users | `GET`/`POST /api/users`, `PATCH`/`DELETE /api/users/:id` |
| Settings | `GET`/`PUT /api/settings/model` (platform admin) |

Route handlers live in [`src/app/api`](../src/app/api), one folder per path.
