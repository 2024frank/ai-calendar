import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { describe, it, type TestContext } from "node:test";
import { eq, getTableColumns } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql-proxy";

import * as schema from "../src/db/schema";
import { loadRoute } from "./helpers/load-route";

const FROZEN_NOW = Date.parse("2026-09-05T12:00:00Z");
const APOLLO_ORG_URL = "https://www.apollotheateroberlin.org/movies";
const SHARED_VEEZI_URL =
  "https://prod3.agileticketing.net/websales/pages/list.aspx?epguid=apollo";
const POSTER_URL = "https://images.example.org/apollo-poster.jpg";

const at = (iso: string) => Math.floor(Date.parse(iso) / 1_000);
const window = (start: string, end: string) => [
  { startTime: at(start), endTime: at(end) },
];
const SEP_1_TO_10 = window("2026-09-01T04:00:00Z", "2026-09-11T03:59:59Z");
const SEP_5_TO_10 = window("2026-09-05T04:00:00Z", "2026-09-11T03:59:59Z");
const SEP_5_TO_12 = window("2026-09-05T04:00:00Z", "2026-09-13T03:59:59Z");

type InventoryItem = {
  eventType: string | null;
  title: string;
  startTimes: number[];
  sessions: { startTime: number; endTime: number }[];
  location: string | null;
  description: string | null;
  sourceUrls: string[];
  url: string | null;
};

type StoredEvent = {
  id: number;
  status: string;
  event_type: string | null;
  title: string;
  description: string;
  sessions: string;
  duplicate_of_event_id: number | null;
  duplicate_of_url: string | null;
  calendar_source_url: string | null;
};

function createTable(
  store: DatabaseSync,
  name: string,
  table: typeof schema.events | typeof schema.sources | typeof schema.communities |
    typeof schema.publishSubmissions | typeof schema.runs | typeof schema.runEvents,
) {
  const columns = Object.values(getTableColumns(table));
  store.exec(`CREATE TABLE ${name} (${columns.map((column) => {
    if (column.name === "id") return "`id` INTEGER PRIMARY KEY AUTOINCREMENT";
    const type = /int|boolean/i.test(column.getSQLType()) ? "INTEGER" : "TEXT";
    return `\`${column.name}\` ${type}`;
  }).join(",")})`);
}

function fixture(
  t: TestContext,
  options: { sourceSlug?: string; remoteInventory?: InventoryItem[] } = {},
) {
  const realDateNow = Date.now;
  Date.now = () => FROZEN_NOW;
  t.after(() => { Date.now = realDateNow; });

  const store = new DatabaseSync(":memory:");
  t.after(() => store.close());
  createTable(store, "communities", schema.communities);
  createTable(store, "sources", schema.sources);
  createTable(store, "events", schema.events);
  createTable(store, "publish_submissions", schema.publishSubmissions);
  createTable(store, "runs", schema.runs);
  createTable(store, "run_events", schema.runEvents);

  store.prepare(`
    INSERT INTO communities (id, slug, name, timezone, default_mode, status)
    VALUES (1, 'oberlin', 'Oberlin', 'America/New_York', 'needs_approval', 'active')
  `).run();
  store.prepare(`
    INSERT INTO sources (
      id, community_id, slug, name, source_type, source_kind, url, mode,
      lookahead_days, active, org_name, org_website, org_phone,
      org_contact_email, calendar_source_name, calendar_source_url
    ) VALUES (1, 1, ?, 'Apollo Theater', 'web', 'original_org', ?,
      'needs_approval', 14, 1, 'Apollo Theater', ?, '440-774-3920',
      'hello@apollotheateroberlin.org', 'Apollo Theater', ?)
  `).run(options.sourceSlug ?? "apollo-theater", APOLLO_ORG_URL, APOLLO_ORG_URL, APOLLO_ORG_URL);
  store.prepare(`
    INSERT INTO runs (id, community_id, source_id, status, phase)
    VALUES (1, 1, 1, 'running', 'ingesting')
  `).run();

  const db = drizzle(async (sql, params, method) => {
    // MySQL accepts DEFAULT as an individual VALUES expression; SQLite does
    // not. These in-memory tables intentionally have nullable generated fields,
    // so NULL is the equivalent test-driver representation.
    const query = sql.replace(/\s+for update$/i, "").replace(/\bdefault\b/gi, "NULL");
    const statement = store.prepare(query);
    if (method === "all") {
      statement.setReturnArrays(true);
      const rows = statement.all(...params) as unknown as unknown[][];
      // mysql2 returns JSON columns as parsed values; reproduce that driver
      // behavior rather than leaking SQLite's JSON text into real Drizzle code.
      return { rows: rows.map((row) => row.map((value) => {
        if (typeof value !== "string" || !/^[\[{]/.test(value)) return value;
        try { return JSON.parse(value); } catch { return value; }
      })) };
    }
    if (/^\s*select\b/i.test(query)) {
      return { rows: [statement.all(...params)] };
    }
    const result = statement.run(...params);
    return {
      rows: [{ affectedRows: Number(result.changes), insertId: Number(result.lastInsertRowid) }],
    };
  });

  const runEvents = loadRoute<typeof import("../src/lib/runEvents")>(
    new URL("../src/lib/runEvents.ts", import.meta.url),
    { "server-only": {}, "@/db": { db }, "@/db/schema": schema },
  );
  const inventory = {
    fetchDestinationInventory: async () => ({
      available: true,
      items: options.remoteInventory ?? [],
    }),
  };
  const ingest = loadRoute<typeof import("../src/lib/ingest")>(
    new URL("../src/lib/ingest.ts", import.meta.url),
    {
      "server-only": {},
      "@/db": { db },
      "@/db/schema": schema,
      "./fetchPage": {
        fetchPage: async () => ({ ok: true, status: 200, bytes: 0, text: "", jsonLd: [] }),
        fetchPublicBytes: async () => ({ ok: true, status: 200, bytes: new Uint8Array() }),
        hasImageExtension: () => true,
        isGenericImage: () => false,
      },
      "./mergePosters": { mergePosterImages: async () => null },
      "./inventory": inventory,
      "./publishEvent": {
        publishEvent: async () => ({ ok: false, state: "failed", message: "not used" }),
      },
      "./inlineImage": {
        inlineRemoteImage: async () => ({ failure: "not used" }),
      },
      "./email": { sendNewEventsDigest: async () => undefined },
      "./runEvents": runEvents,
    },
  );

  const seedEvent = (overrides: {
    id?: number;
    status?: string;
    eventType?: string;
    title?: string;
    description?: string;
    sessions?: { startTime: number; endTime: number }[];
    dedupKey?: string;
    website?: string;
    calendarSourceUrl?: string;
  } = {}) => {
    const sessions = overrides.sessions ?? SEP_1_TO_10;
    store.prepare(`
      INSERT INTO events (
        id, community_id, source_id, status, event_type, title, description,
        sessions, start_time_max, location_type, display_type, post_type_ids,
        sponsors, website, image_cdn_url, contact_email, phone, dedup_key,
        calendar_source_name, calendar_source_url
      ) VALUES (?, 1, 1, ?, ?, ?, ?, ?, ?, 'ne', 'all', '[5]',
        '["Apollo Theater"]', ?, ?, 'hello@apollotheateroberlin.org',
        '440-774-3920', ?, 'Apollo Theater', ?)
    `).run(
      overrides.id ?? 1797,
      overrides.status ?? "approved",
      overrides.eventType ?? "an",
      overrides.title ?? "Playing Now at the Apollo",
      overrides.description ?? "Dog Stars: Sep 1 to Sep 10 · Coyote vs. Acme: Sep 1 to Sep 10",
      JSON.stringify(sessions),
      Math.max(...sessions.map((session) => session.startTime)),
      overrides.website ?? SHARED_VEEZI_URL,
      POSTER_URL,
      overrides.dedupKey ?? "existing-reviewer-hash",
      overrides.calendarSourceUrl ?? APOLLO_ORG_URL,
    );
  };

  const candidate = (overrides: Record<string, unknown> = {}) => ({
    eventType: "an",
    title: "Playing Now at the Apollo",
    description: "Practical Magic: Sep 1 to Sep 10",
    sessions: SEP_1_TO_10,
    locationType: "ne",
    postTypeId: [5],
    sponsors: ["Apollo Theater"],
    website: SHARED_VEEZI_URL,
    calendarSourceUrl: APOLLO_ORG_URL,
    imageCdnUrl: POSTER_URL,
    contactEmail: "hello@apollotheateroberlin.org",
    phone: "440-774-3920",
    ...overrides,
  });

  const runIngest = async (rawEvents: Record<string, unknown>[]) => {
    const [source] = await db.select().from(schema.sources).where(eq(schema.sources.id, 1));
    const [community] = await db.select().from(schema.communities).where(eq(schema.communities.id, 1));
    return ingest.ingestEvents(1, source, community, rawEvents, { deadlineAt: 0 });
  };
  const allEvents = () => store.prepare(`
    SELECT id, status, event_type, title, description, sessions,
      duplicate_of_event_id, duplicate_of_url, calendar_source_url
    FROM events ORDER BY id
  `).all() as unknown as StoredEvent[];

  return { store, seedEvent, candidate, runIngest, allEvents };
}

function insertedEvent(f: ReturnType<typeof fixture>): StoredEvent {
  const rows = f.allEvents();
  assert.equal(rows.length, 2);
  return rows[1];
}

describe("Apollo ingestion duplicate regression", () => {
  it("keeps a different coming-soon film pending despite shared Veezi and organization URLs", async (t) => {
    const f = fixture(t);
    f.seedEvent();

    await f.runIngest([f.candidate({
      title: "Coming Soon at the Apollo",
      description: "Practical Magic: opens Sep 10",
      sessions: SEP_5_TO_10,
    })]);

    const saved = insertedEvent(f);
    assert.equal(saved.status, "pending");
    assert.equal(saved.duplicate_of_event_id, null);
    assert.equal(saved.duplicate_of_url, null);
  });

  it("keeps a changed film pending when generic title and display dates match", async (t) => {
    const f = fixture(t);
    f.seedEvent();

    await f.runIngest([f.candidate()]);

    const saved = insertedEvent(f);
    assert.equal(saved.status, "pending");
    assert.equal(saved.duplicate_of_event_id, null);
  });

  it("ignores a known local duplicate hint when the full Apollo film payload changed", async (t) => {
    const f = fixture(t);
    f.seedEvent();

    await f.runIngest([f.candidate({ _agentDuplicateOfId: 1797 })]);

    const saved = insertedEvent(f);
    assert.equal(saved.status, "pending");
    assert.equal(saved.duplicate_of_event_id, null);
  });

  it("ignores an exact stale dedup key when the reviewer-visible film changed", async (t) => {
    const f = fixture(t);
    f.seedEvent({
      // Literal SHA-256 for the candidate title, description and session below.
      dedupKey: "ed7289752ab1e81d3a3db4988b4a6598297095c7cd0e1e7e3a49b35485971d6c",
    });

    await f.runIngest([f.candidate()]);

    const saved = insertedEvent(f);
    assert.equal(saved.status, "pending");
    assert.equal(saved.duplicate_of_event_id, null);
  });

  it("does not let remote inventory or publish history override changed Apollo films", async (t) => {
    const existingDescription = "Dog Stars: Sep 1 to Sep 10 · Coyote vs. Acme: Sep 1 to Sep 10";
    const f = fixture(t, {
      remoteInventory: [{
        eventType: "an",
        title: "Playing Now at the Apollo",
        description: existingDescription,
        startTimes: SEP_1_TO_10.map((session) => session.startTime),
        sessions: SEP_1_TO_10,
        location: null,
        sourceUrls: [SHARED_VEEZI_URL, APOLLO_ORG_URL],
        url: "https://calendar.example.org/calendar/post/9001",
      }],
    });
    f.seedEvent({ status: "published", description: existingDescription });
    f.store.prepare(`
      INSERT INTO publish_submissions
        (id, event_id, destination_id, payload_hash, state)
      VALUES (1, 1797, 7, 'published-payload', 'succeeded')
    `).run();

    await f.runIngest([f.candidate()]);

    const saved = insertedEvent(f);
    assert.equal(saved.status, "pending");
    assert.equal(saved.duplicate_of_event_id, null);
    assert.equal(saved.duplicate_of_url, null);
  });

  it("saves a full duplicate candidate when its unchanged lineup is already covered", async (t) => {
    const f = fixture(t);
    f.seedEvent();
    const before = f.store.prepare("SELECT sessions FROM events WHERE id = 1797").get() as { sessions: string };
    const candidateSessions = SEP_5_TO_10;
    const candidateDescription =
      "Coyote vs. Acme: September 1 to September 10 · Dog Stars: Sep 1 to Sep 10";

    await f.runIngest([f.candidate({
      title: "Now Playing at Apollo",
      description: candidateDescription,
      sessions: candidateSessions,
    })]);

    const saved = insertedEvent(f);
    assert.equal(saved.status, "duplicate");
    assert.equal(saved.duplicate_of_event_id, 1797);
    assert.equal(saved.event_type, "an");
    assert.equal(saved.description, candidateDescription);
    assert.deepEqual(JSON.parse(saved.sessions), candidateSessions);
    const after = f.store.prepare("SELECT sessions FROM events WHERE id = 1797").get() as { sessions: string };
    assert.equal(after.sessions, before.sessions);
  });

  it("keeps additional Apollo coverage pending without merging sessions into the old row", async (t) => {
    const f = fixture(t);
    f.seedEvent({ description: "Dog Stars: Sep 1 to Sep 10" });
    const before = f.store.prepare("SELECT sessions FROM events WHERE id = 1797").get() as { sessions: string };

    await f.runIngest([f.candidate({
      description: "Dog Stars: Sep 1 to Sep 10",
      sessions: SEP_5_TO_12,
    })]);

    const saved = insertedEvent(f);
    assert.equal(saved.status, "pending");
    assert.equal(saved.duplicate_of_event_id, null);
    assert.deepEqual(JSON.parse(saved.sessions), SEP_5_TO_12);
    const after = f.store.prepare("SELECT sessions FROM events WHERE id = 1797").get() as { sessions: string };
    assert.equal(after.sessions, before.sessions);
  });

  it("rejects a title-only Apollo marker before writing any event in the batch", async (t) => {
    const f = fixture(t);
    f.seedEvent();
    const before = f.allEvents();

    await assert.rejects(
      f.runIngest([
        f.candidate({ title: "Coming Soon at the Apollo", description: "Practical Magic: opens Sep 10" }),
        { title: "Playing Now at the Apollo", _agentDuplicateOfId: 1797 },
      ]),
      /Apollo duplicate reports must include complete announcement descriptions and sessions/,
    );

    assert.deepEqual(f.allEvents(), before);
  });

  it("retains classic duplicate behavior for a non-Apollo source", async (t) => {
    const f = fixture(t, { sourceSlug: "other-cinema" });
    f.seedEvent({
      eventType: "ot",
      title: "Community Film Night",
      description: "A neighborhood film screening for all ages.",
    });

    await f.runIngest([f.candidate({
      eventType: "ot",
      title: "Community Film Night",
      description: "Updated details for the neighborhood screening.",
    })]);

    const saved = insertedEvent(f);
    assert.equal(saved.status, "duplicate");
    assert.equal(saved.duplicate_of_event_id, 1797);
  });
});
