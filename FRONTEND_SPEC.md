# AI Calendar — Frontend Build Spec

You are building the **frontend** for a multi-tenant "AI event calendar" SaaS. The backend (database, auth, agents, publishing) already exists and is not your concern. Build the UI and call the JSON API described below. Make it look genuinely professional. The current UI is too plain — raise the bar.

---

## 1. Product in one paragraph

Communities (tenants like Oberlin, Cleveland) have **Sources** (a website or email inbox where events come from). AI agents extract events from each source on a schedule. Extracted events either wait in a **Review queue** for a human to approve (restricted mode) or publish automatically (unrestricted mode). Approved events go to that community's **Destination** (e.g. CommunityHub) and always live in the community's own **AI calendar**. Every agent run is watchable step by step (the "Run timeline"). Admins add users and sources.

**Roles:** `platform_admin` (sees all communities), `community_admin` (one community, manages users + sources + endpoint), `reviewer` (works the review queue for assigned sources).

---

## 2. Tech + how to build it

- **Next.js 15 (App Router) + React 19 + TypeScript.** Put routes under `src/app`. Prefer client components that fetch the JSON API; the session is an httpOnly cookie sent automatically on same-origin requests, so you never handle tokens.
- No component library required. If you use one, keep the bundle light. Tailwind is fine, or plain CSS modules / vanilla-extract — your call. Ship clean, self-contained components.
- Every list/detail view must handle **loading**, **empty**, and **error** states.
- Do not build auth screens' backend — just POST to the endpoints below.

---

## 3. Design direction

Aim for the polish of **Linear / Vercel dashboard / Stripe**: calm, spacious, data-dense but not cramped, crisp typography, subtle depth and motion. Support **light and dark** (respect `prefers-color-scheme`, plus a manual toggle). Fully responsive (usable on mobile: nav collapses to a drawer).

### Brand (use these real assets — already in the repo)

- **Wordmark:** `/brand/communityhub-wordmark.png` (1662×255, transparent PNG, green "COMMUNITYHUB" lockup with a circular hands-holding-a-skyline mark). Use in the sidebar header and on the login screen. Render ~168px wide in the sidebar, ~210px on login.
- **Icon / mark:** `/brand/communityhub-mark.png` (192×192, transparent). Use for compact spots and the favicon (`src/app/icon.png` is already wired).
- Lock the product label **"AI CALENDAR"** beneath the wordmark as small uppercase, letter-spaced, muted text — the wordmark is the brand, "AI Calendar" is the product.
- **Accent color: CommunityHub green** (sampled from the logo, roughly `#4CAF50`; the app currently uses `#2f6d4f` for light and `#5aa77e` for dark surfaces). Keep the accent consistent with the logo so the mark never looks pasted on.
- Both logo files are green on transparent, so they sit correctly on light *and* dark backgrounds — do not put them on a white plate in dark mode.
- Avoid generic purple-gradient-on-white AI slop.

### Rules

- **No emojis anywhere** in the product UI, icons, copy, or emails. Use a clean line-icon set (Lucide or similar) — never `📅 📍 ✅ ❌ ⏳ 📧` as icons or status markers.
- Motion: gentle. Skeleton loaders, not spinners, where possible. Optimistic UI on approve/reject.

---

## 4. Global layout

- **Left sidebar**: brand, primary nav (Dashboard, Review, Sources, Communities [platform_admin only], Users [admin], Settings). Bottom of sidebar: current user (name, role) + Sign out.
- **Topbar** (optional): a **community switcher** for `platform_admin` (dropdown of communities that scopes the whole app), plus a light/dark toggle.
- **Auth gate**: if `GET /api/me` returns 401, redirect to `/login`.

---

## 5. Data model (shapes returned by the API)

```ts
type Role = "platform_admin" | "community_admin" | "reviewer";

type Me = {
  id: number; email: string; name: string | null;
  role: Role; communityId: number | null; canReviewAllSources: boolean;
};

type Community = {
  id: number; slug: string; name: string; timezone: string;
  defaultMode: "restricted" | "unrestricted";
  defaultDestinationId: number | null; status: "active" | "suspended";
};

type Destination = {
  id: number; communityId: number; name: string;
  type: "ai_calendar" | "communityhub" | "webhook" | "ical";
  config: Record<string, unknown>; active: boolean;
};

type Source = {
  id: number; communityId: number; name: string; slug: string;
  sourceType: "web" | "email"; sourceKind: "original_org" | "aggregator";
  url: string | null; specialInstructions: string | null;
  mode: "restricted" | "unrestricted" | null;   // null = inherit community.defaultMode
  destinationId: number | null;                 // null = inherit community.defaultDestinationId
  discoveryStatus: "pending" | "discovering" | "ready" | "failed" | "stale";
  extractionRecipe: { extraction_method?: string; instruction_block?: string; notes?: string } | null;
  scheduleCron: string | null; active: boolean;
  orgName: string | null; orgWebsite: string | null;
};

type EventItem = {
  id: number; communityId: number; sourceId: number | null;
  status: "pending" | "approved" | "submitted" | "rejected" | "duplicate" | "auto_rejected";
  eventType: "ot" | "an" | "jp" | null;  // event | announcement | job
  title: string | null; description: string | null; extendedDescription: string | null;
  sessions: { startTime: number; endTime: number }[] | null; // unix seconds
  locationType: "ph2" | "on" | "bo" | "ne" | null; location: string | null; urlLink: string | null;
  postTypeIds: number[] | null; sponsors: string[] | null;
  imageCdnUrl: string | null; registrationUrl: string | null;
  provenance: "direct" | "original_org" | "aggregator" | null;
  publishedVia: "reviewer" | "auto" | null;
  duplicateOfEventId: number | null; rejectionReason: string | null;
  createdAt: string;
};

type Run = {
  id: number; communityId: number | null; sourceId: number | null;
  runKind: "extraction" | "discovery";
  status: "running" | "completed" | "failed" | "stopped";
  control: "run" | "pause" | "stop";
  phase: string | null; startedAt: string; finishedAt: string | null;
  budgetTotal: number | null; promptTokens: number; completionTokens: number;
  eventsFound: number; eventsExtracted: number; eventsDuplicate: number;
  eventsInvalid: number; eventsPublished: number;
};

type RunEvent = {
  id: number; runId: number; seq: number; ts: string;
  kind: string;   // run_started | model_turn | fetch_issued | fetch_result | search_issued |
                  // candidates_parsed | candidate_validated | dedup_outcome | queue_outcome |
                  // budget_checkpoint | run_finished | run_failed | cancel_observed ...
  label: string | null; data: Record<string, unknown> | null;
};

type UserRow = {
  id: number; email: string; name: string | null; role: Role;
  communityId: number | null; canReviewAllSources: boolean; status: "active" | "disabled";
};
```

Post-type taxonomy (CommunityHub categories), id → label, for rendering event categories:
`1 Volunteer Opportunity, 2 Exhibit, 3 Fair/Festival, 4 Tour/Open House, 5 Film, 6 Presentation/Lecture, 7 Workshop/Class, 8 Music Performance, 9 Theatre/Dance, 10 City Government, 11 Spectator Sport, 12 Participatory Sport, 13 Networking, 59 Ecolympics/Environmental, 89 Other`.

---

## 6. API contract (same-origin, JSON, cookie auth)

All return JSON. `401` = not signed in (redirect to /login). `403` = insufficient role. Errors: `{ error: string }`.

**Auth**
- `POST /api/auth/request` → body `{ email }` → `{ ok: true, devLink?: string }` (devLink only when email delivery is not configured).
- `GET  /api/auth/verify?token=…` → redirects, sets session cookie. (Frontend just links to it.)
- `POST /api/auth/logout` → redirects to /login.
- `GET  /api/me` → `Me` or 401.

**Dashboard**
- `GET /api/dashboard` → `{ activeSources, pending, approved, submitted, duplicate, recentRuns: Run[] }`.

**Communities** (read: any; write: platform_admin)
- `GET /api/communities` → `Community[]`
- `GET /api/communities/:id` → `{ community: Community, destinations: Destination[] }`
- `POST /api/communities` → `{ name, slug, timezone, defaultMode }`
- `PATCH /api/communities/:id` → partial `Community`

**Destinations** (admin)
- `GET  /api/communities/:id/destinations` → `Destination[]`
- `POST /api/communities/:id/destinations` → `{ name, type, config, active }`
- `PATCH /api/destinations/:id` → partial

**Sources** (scoped to role)
- `GET  /api/sources` → `Source[]`
- `POST /api/sources` → `{ name, url?, sourceType, specialInstructions?, communityId? }` → `{ id }` (kicks off discovery)
- `GET  /api/sources/:id` → `{ source: Source, recentRuns: Run[] }`
- `PATCH /api/sources/:id` → partial (`mode`, `active`, `scheduleCron`, `destinationId`, `specialInstructions`, `url`)
- `POST /api/sources/:id/run` → `{ runId }` (start a Source Agent extraction now)
- `POST /api/sources/:id/discover` → `{ runId }` (re-run the Discovery Agent)

**Runs**
- `GET /api/runs?sourceId=…` → `Run[]`
- `GET /api/runs/:id` → `Run`
- `GET /api/runs/:id/events?after=<lastId>` → `{ events: RunEvent[], nextAfter: number, status, phase, terminal: boolean }`
- `GET /api/runs/:id/stream` → **SSE** stream of `RunEvent` (each `data:` line is one event; an `event: end` closes it). Use this for the live timeline; fall back to polling `…/events?after=` every 1s.
- `POST /api/runs/:id/stop | /pause | /resume` → `{ ok: true }`

**Review / events**
- `GET  /api/events?status=pending` → `EventItem[]` (scoped)
- `GET  /api/events/:id` → `{ event: EventItem, source: Source, duplicateCandidates?: EventItem[], payloadPreview?: object }`
- `PATCH /api/events/:id` → partial edits (reviewer corrections)
- `POST /api/events/:id/approve` → `{ ok: true }` (publishes to endpoint + AI calendar)
- `POST /api/events/:id/reject` → `{ reasonCode, note? }`

**Users** (admin)
- `GET  /api/users?communityId=…` → `UserRow[]`
- `POST /api/users/invite` → `{ email, name?, role, communityId?, sourceIds?: number[] }`
- `PATCH /api/users/:id` → partial (`role`, `status`, `canReviewAllSources`)

---

## 7. Screens (build all of these)

1. **/login** — centered card. Email field → `POST /api/auth/request`. After submit show "check your email"; if `devLink` present, show it as a clickable link (dev mode). No password.
2. **/dashboard** — KPI cards (Active sources, Pending review, Approved, Published) linking to their lists; a Communities summary (platform_admin); a "Recent runs" list linking to run timelines.
3. **/sources** — table of sources: name, community, type, effective mode, discovery status (badge), active toggle. Row → detail. "Add source" button.
4. **/sources/new** — form: name, type (web/email), link (if web), **optional special instructions** (multiline), community (platform_admin only). On submit, create and route to the new source's detail, where its Discovery run timeline is shown live.
5. **/sources/:id** — header (name, badges), key fields (link, effective mode with a toggle restricted/unrestricted, extraction method, schedule, org/sponsor), special instructions, the extraction recipe (collapsible code block), and a Runs table. Buttons: **Run now**, **Re-discover**, **Edit**.
6. **/review** — the queue: pending events with title, type, when (from `sessions[0].startTime`), location, source, added-time. Row → detail. Bulk-friendly if easy.
7. **/review/:id** — the important one. Show the event nicely (title, category chips from postTypeIds, date/time, location or online link, sponsors, description + extended description, image if any, registration button). Make every field **editable inline**. Show a **payload preview** (what will be sent to the endpoint). Show **duplicate flags** if `duplicateCandidates` exist (highlight matching date + location). Actions: **Approve & publish**, **Reject** (reason code + note), **Save edits**.
8. **/runs/:id** — the **live Run Timeline** (see §8).
9. **/communities** (platform_admin) — cards per community: name, mode, timezone, endpoints (with active state), source count. Manage → detail with destination config editor.
10. **/users** (admin) — table of users in the community; "Invite user" (email, role, assign sources for reviewers). Edit role/status.
11. **/settings** — profile + light/dark toggle; admins: community defaults (timezone, default mode, default destination).

---

## 8. The star feature: live Run Timeline (/runs/:id)

This is what makes the product feel different, so make it excellent.

- Header: run #, kind (extraction/discovery), status chip (running/completed/failed/stopped), source name, started/finished times, and a **live token/budget meter** (promptTokens + completionTokens vs budgetTotal).
- Controls when running: **Stop**, **Pause**, **Resume** (call the run control endpoints).
- Body: a **vertical timeline** that streams in `RunEvent`s from `GET /api/runs/:id/stream` (SSE), newest at the bottom, auto-scroll. Each event renders by `kind`:
  - `fetch_issued`/`fetch_result` — show the URL and retrieved size (paired).
  - `search_issued`/`search_result` — query + result count.
  - `model_turn` — a "thinking/summary" line + token usage for that turn.
  - `candidate_validated` — event title + valid/invalid + issues.
  - `dedup_outcome` — "duplicate of …" or "unique", with the reason (date/location match).
  - `queue_outcome` — inserted / auto-published / sent to review, linking to the event.
  - `run_finished`/`run_failed` — terminal summary; stop streaming, flip the header chip.
- Reconnect logic: on load, GET `…/events?after=0` for history, then open the SSE stream and de-dupe by `id`. If SSE is unavailable, poll `…/events?after=<lastId>` every 1s until `terminal: true`.
- A run must never look "stuck forever": show elapsed time and, when terminal, a clear ended state.

---

## 9. States, accessibility, responsive

- Every table/list: skeleton on load, friendly empty state, and an error state with retry.
- Keyboard accessible, proper labels, focus rings, sufficient contrast in both themes.
- Mobile: sidebar → top drawer; tables → stacked cards or horizontal scroll.
- Badges: status colors (running=amber, completed/approved/published=green, failed/rejected=red, neutral=grey).

---

## 10. Hard rules

- **No emojis** anywhere.
- No passwords in the UI (email-link auth only).
- Don't invent endpoints; if you need data that isn't in §6, list it separately so the backend can add it.
- Keep the product name in one config constant.

Deliver a set of Next.js App Router routes + components implementing all screens above, wired to the API in §6, with light/dark and responsive layouts.
