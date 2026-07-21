import {
  bigint,
  boolean,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  varchar,
  type AnyMySqlColumn,
} from "drizzle-orm/mysql-core";

/* Enum value sets (MySQL enums are per-column) */
const MODE = ["restricted", "unrestricted"] as const;
const COMMUNITY_STATUS = ["active", "suspended"] as const;
const USER_ROLE = ["platform_admin", "community_admin", "reviewer"] as const;
const USER_STATUS = ["active", "disabled"] as const;
const LOGIN_KIND = ["magic", "otp"] as const;
const SOURCE_TYPE = ["web", "email"] as const;
const SOURCE_KIND = ["original_org", "aggregator"] as const;
const DISCOVERY_STATUS = ["pending", "discovering", "ready", "failed", "stale"] as const;
const DESTINATION_TYPE = ["ai_calendar", "communityhub", "webhook", "ical"] as const;
const RUN_KIND = ["extraction", "discovery"] as const;
const RUN_STATUS = ["running", "completed", "failed", "stopped"] as const;
const RUN_CONTROL = ["run", "pause", "stop"] as const;
const EVENT_STATUS = [
  "pending",
  "approved",
  "submitted",
  "rejected",
  "duplicate",
  "auto_rejected",
] as const;
const PUBLISHED_VIA = ["reviewer", "auto"] as const;
const PROVENANCE = ["direct", "original_org", "aggregator"] as const;
const RULE_ORIGIN = ["promoted", "manual"] as const;
const RULE_STATUS = ["active", "suspended"] as const;
const SUBMISSION_STATE = [
  "prepared",
  "sending",
  "succeeded",
  "failed",
  "accepted_unreconciled",
] as const;
const JOB_KIND = ["extract_source"] as const;
const JOB_STATUS = ["queued", "running", "succeeded", "failed"] as const;

/* ------------------------------------------------------------------ *
 * Tenancy
 * ------------------------------------------------------------------ */
export const communities = mysqlTable("communities", {
  id: int("id").autoincrement().primaryKey(),
  slug: varchar("slug", { length: 80 }).notNull().unique(),
  name: varchar("name", { length: 200 }).notNull(),
  timezone: varchar("timezone", { length: 64 }).notNull().default("America/New_York"),
  defaultMode: mysqlEnum("default_mode", MODE).notNull().default("restricted"),
  // Plain int (no hard FK) to avoid a cyclic FK with destinations.
  defaultDestinationId: int("default_destination_id"),
  status: mysqlEnum("status", COMMUNITY_STATUS).notNull().default("active"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
});

export const destinations = mysqlTable(
  "destinations",
  {
    id: int("id").autoincrement().primaryKey(),
    communityId: int("community_id")
      .notNull()
      .references(() => communities.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 200 }).notNull(),
    type: mysqlEnum("type", DESTINATION_TYPE).notNull(),
    config: json("config").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
  },
  (t) => [index("idx_dest_community").on(t.communityId)],
);

/* ------------------------------------------------------------------ *
 * Users & auth (Resend passwordless)
 * ------------------------------------------------------------------ */
export const users = mysqlTable(
  "users",
  {
    id: int("id").autoincrement().primaryKey(),
    // Nullable for platform_admin (spans communities).
    communityId: int("community_id").references(() => communities.id, { onDelete: "cascade" }),
    role: mysqlEnum("role", USER_ROLE).notNull().default("reviewer"),
    email: varchar("email", { length: 320 }).notNull().unique(),
    name: varchar("name", { length: 200 }),
    passwordHash: varchar("password_hash", { length: 255 }),
    mustSetPassword: boolean("must_set_password").notNull().default(true),
    canReviewAllSources: boolean("can_review_all_sources").notNull().default(false),
    status: mysqlEnum("status", USER_STATUS).notNull().default("active"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
  },
  (t) => [index("idx_users_community").on(t.communityId)],
);

export const loginTokens = mysqlTable(
  "login_tokens",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: mysqlEnum("kind", LOGIN_KIND).notNull(),
    tokenHash: varchar("token_hash", { length: 128 }).notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    consumedAt: timestamp("consumed_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("idx_login_tokens_hash").on(t.tokenHash)],
);

/* ------------------------------------------------------------------ *
 * Sources
 * ------------------------------------------------------------------ */
export const sources = mysqlTable(
  "sources",
  {
    id: int("id").autoincrement().primaryKey(),
    communityId: int("community_id")
      .notNull()
      .references(() => communities.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 200 }).notNull(),
    slug: varchar("slug", { length: 120 }).notNull(),
    sourceType: mysqlEnum("source_type", SOURCE_TYPE).notNull().default("web"),
    sourceKind: mysqlEnum("source_kind", SOURCE_KIND).notNull().default("original_org"),
    url: varchar("url", { length: 2048 }),
    // Optional creator note to steer the Discovery Agent.
    specialInstructions: text("special_instructions"),
    mode: mysqlEnum("mode", MODE), // NULL = inherit community.default_mode
    destinationId: int("destination_id").references(() => destinations.id, { onDelete: "set null" }),
    discoveryStatus: mysqlEnum("discovery_status", DISCOVERY_STATUS).notNull().default("pending"),
    extractionRecipe: json("extraction_recipe"),
    startUrls: json("start_urls"),
    scheduleCron: varchar("schedule_cron", { length: 120 }),
    // How many days ahead the agent looks for events. NULL = the 14-day default.
    lookaheadDays: int("lookahead_days"),
    active: boolean("active").notNull().default(true),
    discoveryError: text("discovery_error"),
    recipeUpdatedAt: timestamp("recipe_updated_at"),
    orgName: varchar("org_name", { length: 200 }),
    orgWebsite: varchar("org_website", { length: 2048 }),
    orgPhone: varchar("org_phone", { length: 64 }),
    orgContactEmail: varchar("org_contact_email", { length: 320 }),
    calendarSourceName: varchar("calendar_source_name", { length: 200 }),
    calendarSourceUrl: varchar("calendar_source_url", { length: 2048 }),
    legacyAgentId: varchar("legacy_agent_id", { length: 120 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
  },
  (t) => [
    uniqueIndex("uq_sources_community_slug").on(t.communityId, t.slug),
    index("idx_sources_community").on(t.communityId),
  ],
);

/**
 * Extra communities a user may work in beyond `users.community_id`. A reviewer
 * or admin can then switch between the communities they belong to.
 */
export const userCommunities = mysqlTable(
  "user_communities",
  {
    userId: int("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    communityId: int("community_id")
      .notNull()
      .references(() => communities.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.communityId] })],
);

export const reviewerSources = mysqlTable(
  "reviewer_sources",
  {
    userId: int("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sourceId: int("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.sourceId] })],
);

/* ------------------------------------------------------------------ *
 * Events (the AI calendar store)
 * ------------------------------------------------------------------ */
export const events = mysqlTable(
  "events",
  {
    id: int("id").autoincrement().primaryKey(),
    communityId: int("community_id")
      .notNull()
      .references(() => communities.id, { onDelete: "cascade" }),
    sourceId: int("source_id").references(() => sources.id, { onDelete: "set null" }),
    status: mysqlEnum("status", EVENT_STATUS).notNull().default("pending"),
    eventType: varchar("event_type", { length: 2 }),
    title: varchar("title", { length: 200 }),
    description: text("description"),
    extendedDescription: text("extended_description"),
    sessions: json("sessions"), // [{startTime,endTime}] unix seconds
    startTimeMax: int("start_time_max"), // latest session start (unix secs) for expiry sweeps
    locationType: varchar("location_type", { length: 8 }),
    location: text("location"),
    placeName: varchar("place_name", { length: 200 }),
    roomNum: varchar("room_num", { length: 120 }),
    geoScope: varchar("geo_scope", { length: 20 }),
    urlLink: varchar("url_link", { length: 2048 }),
    displayType: varchar("display_type", { length: 8 }),
    postTypeIds: json("post_type_ids"),
    screensIds: json("screens_ids"),
    sponsors: json("sponsors"),
    buttons: json("buttons"),
    imageCdnUrl: varchar("image_cdn_url", { length: 2048 }),
    // Base64 JPEG for images we build ourselves, e.g. merged Apollo posters.
    imageData: text("image_data"),
    website: varchar("website", { length: 2048 }),
    registrationUrl: varchar("registration_url", { length: 2048 }),
    contactEmail: varchar("contact_email", { length: 320 }),
    phone: varchar("phone", { length: 64 }),
    calendarSourceName: varchar("calendar_source_name", { length: 200 }),
    calendarSourceUrl: varchar("calendar_source_url", { length: 2048 }),
    // Deep link back to this event's reviewer record, sent with the payload so
    // anyone looking at the published post can jump to the record behind it.
    ingestedPostUrl: varchar("ingested_post_url", { length: 2048 }),
    fieldNotes: json("field_notes"),
    dedupKey: varchar("dedup_key", { length: 64 }),
    provenance: mysqlEnum("provenance", PROVENANCE),
    publishedVia: mysqlEnum("published_via", PUBLISHED_VIA),
    duplicateOfEventId: int("duplicate_of_event_id").references((): AnyMySqlColumn => events.id, {
      onDelete: "set null",
    }),
    // The already-published CommunityHub post this duplicates, when the match
    // was remote rather than another event in this app.
    duplicateOfUrl: text("duplicate_of_url"),
    rejectionReason: text("rejection_reason"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
  },
  (t) => [
    index("idx_events_community_dedup").on(t.communityId, t.dedupKey),
    index("idx_events_source").on(t.sourceId),
    index("idx_events_status").on(t.status),
    // Retention sweep: purge past-date, restricted, unapproved events.
    index("idx_events_expiry").on(t.status, t.startTimeMax),
  ],
);

/* ------------------------------------------------------------------ *
 * Runs + observable trail
 * ------------------------------------------------------------------ */
export const runs = mysqlTable(
  "runs",
  {
    id: int("id").autoincrement().primaryKey(),
    communityId: int("community_id").references(() => communities.id, { onDelete: "cascade" }),
    sourceId: int("source_id").references(() => sources.id, { onDelete: "cascade" }),
    runKind: mysqlEnum("run_kind", RUN_KIND).notNull().default("extraction"),
    status: mysqlEnum("status", RUN_STATUS).notNull().default("running"),
    control: mysqlEnum("control", RUN_CONTROL).notNull().default("run"),
    phase: varchar("phase", { length: 24 }),
    startedAt: timestamp("started_at").notNull().defaultNow(),
    finishedAt: timestamp("finished_at"),
    deadlineAt: timestamp("deadline_at", { fsp: 3 }),
    budgetTotal: int("budget_total"),
    promptTokens: int("prompt_tokens").notNull().default(0),
    completionTokens: int("completion_tokens").notNull().default(0),
    // Dollar cost of this run, as reported by the Agent API (no markup). Stored
    // in micro-dollars (millionths) to keep it an exact integer.
    costMicros: int("cost_micros").notNull().default(0),
    // Which model actually served this run, so models can be compared.
    model: varchar("model", { length: 80 }),
    eventsFound: int("events_found").notNull().default(0),
    eventsExtracted: int("events_extracted").notNull().default(0),
    eventsDuplicate: int("events_duplicate").notNull().default(0),
    eventsInvalid: int("events_invalid").notNull().default(0),
    eventsPublished: int("events_published").notNull().default(0),
    errorLog: json("error_log"),
    scheduleSlot: timestamp("schedule_slot"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("idx_runs_source").on(t.sourceId), index("idx_runs_status").on(t.status)],
);

export const runEvents = mysqlTable(
  "run_events",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    runId: int("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    seq: int("seq").notNull(),
    ts: timestamp("ts", { fsp: 3 }).notNull().defaultNow(),
    kind: varchar("kind", { length: 40 }).notNull(),
    label: varchar("label", { length: 255 }),
    data: json("data"),
  },
  (t) => [uniqueIndex("uq_run_seq").on(t.runId, t.seq), index("idx_run_tail").on(t.runId, t.id)],
);

export const runState = mysqlTable("run_state", {
  runId: int("run_id")
    .primaryKey()
    .references(() => runs.id, { onDelete: "cascade" }),
  phase: varchar("phase", { length: 24 }).notNull().default("browsing"),
  iteration: int("iteration").notNull().default(0),
  repairAttempts: int("repair_attempts").notNull().default(0),
  messagesJson: text("messages_json").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
});

/**
 * Durable hand-off between HTTP/scheduler requests and expensive extraction.
 *
 * `dedupeKey` is populated only while a job is active. Its unique constraint
 * prevents two app instances from scheduling the same source concurrently;
 * workers clear it when the job reaches a terminal state.
 */
export const jobs = mysqlTable(
  "jobs",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    runId: int("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" })
      .unique(),
    kind: mysqlEnum("kind", JOB_KIND).notNull(),
    status: mysqlEnum("status", JOB_STATUS).notNull().default("queued"),
    dedupeKey: varchar("dedupe_key", { length: 191 }).unique(),
    attempts: int("attempts").notNull().default(0),
    maxAttempts: int("max_attempts").notNull().default(2),
    availableAt: timestamp("available_at", { fsp: 3 }).notNull().defaultNow(),
    lockedAt: timestamp("locked_at", { fsp: 3 }),
    lockedBy: varchar("locked_by", { length: 120 }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { fsp: 3 }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { fsp: 3 }).notNull().defaultNow().onUpdateNow(),
  },
  (t) => [
    index("idx_jobs_available").on(t.status, t.availableAt),
    index("idx_jobs_stale").on(t.status, t.lockedAt),
  ],
);

/** Fixed-window counters shared by every web/worker instance. */
export const rateLimitBuckets = mysqlTable(
  "rate_limit_buckets",
  {
    // Hash the logical key so IP addresses and emails are not stored as keys.
    keyHash: varchar("key_hash", { length: 64 }).primaryKey(),
    windowStartedAtMs: bigint("window_started_at_ms", { mode: "number" }).notNull(),
    count: int("count").notNull().default(0),
    expiresAt: timestamp("expires_at", { fsp: 3 }).notNull(),
    updatedAt: timestamp("updated_at", { fsp: 3 }).notNull().defaultNow().onUpdateNow(),
  },
  (t) => [index("idx_rate_limit_expiry").on(t.expiresAt)],
);

/* ------------------------------------------------------------------ *
 * Learning loop
 * ------------------------------------------------------------------ */
export const sourceRules = mysqlTable(
  "source_rules",
  {
    id: int("id").autoincrement().primaryKey(),
    sourceId: int("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    communityId: int("community_id")
      .notNull()
      .references(() => communities.id, { onDelete: "cascade" }),
    fieldName: varchar("field_name", { length: 60 }).notNull(),
    preferredValue: varchar("preferred_value", { length: 255 }).notNull(),
    canonicalValue: varchar("canonical_value", { length: 255 }).notNull(),
    supportCount: int("support_count").notNull().default(0),
    status: mysqlEnum("status", RULE_STATUS).notNull().default("active"),
    origin: mysqlEnum("origin", RULE_ORIGIN).notNull().default("promoted"),
    createdBy: int("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
  },
  (t) => [uniqueIndex("uq_source_rule").on(t.sourceId, t.fieldName)],
);

export const rejectionLog = mysqlTable(
  "rejection_log",
  {
    id: int("id").autoincrement().primaryKey(),
    eventId: int("event_id").references(() => events.id, { onDelete: "set null" }),
    sourceId: int("source_id").references(() => sources.id, { onDelete: "cascade" }),
    reasonCode: varchar("reason_code", { length: 64 }),
    note: text("note"),
    reviewerId: int("reviewer_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("idx_rejection_source").on(t.sourceId)],
);

export const fieldEditLog = mysqlTable(
  "field_edit_log",
  {
    id: int("id").autoincrement().primaryKey(),
    eventId: int("event_id").references(() => events.id, { onDelete: "set null" }),
    sourceId: int("source_id").references(() => sources.id, { onDelete: "cascade" }),
    fieldName: varchar("field_name", { length: 60 }).notNull(),
    oldValue: text("old_value"),
    newValue: text("new_value"),
    reviewerId: int("reviewer_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("idx_field_edit_source").on(t.sourceId)],
);

/* ------------------------------------------------------------------ *
 * Cross-community identity (link, not suppress)
 * ------------------------------------------------------------------ */
export const eventIdentities = mysqlTable("event_identities", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  globalKey: varchar("global_key", { length: 64 }).notNull().unique(),
  canonicalTitle: varchar("canonical_title", { length: 255 }),
  firstSeenAt: timestamp("first_seen_at").notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
  occurrenceCount: int("occurrence_count").notNull().default(0),
});

export const eventIdentityLinks = mysqlTable(
  "event_identity_links",
  {
    identityId: bigint("identity_id", { mode: "number" })
      .notNull()
      .references(() => eventIdentities.id, { onDelete: "cascade" }),
    eventId: int("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    communityId: int("community_id").notNull(),
    sourceId: int("source_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.identityId, t.eventId] }),
    index("idx_identity_link_event").on(t.eventId),
  ],
);

/* ------------------------------------------------------------------ *
 * Idempotent publish outbox (destination-generic)
 * ------------------------------------------------------------------ */
export const publishSubmissions = mysqlTable(
  "publish_submissions",
  {
    id: int("id").autoincrement().primaryKey(),
    eventId: int("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    destinationId: int("destination_id")
      .notNull()
      .references(() => destinations.id, { onDelete: "cascade" }),
    payloadHash: varchar("payload_hash", { length: 64 }).notNull(),
    state: mysqlEnum("state", SUBMISSION_STATE).notNull().default("prepared"),
    externalPostId: varchar("external_post_id", { length: 120 }),
    payload: json("payload"),
    error: json("error"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
  },
  (t) => [uniqueIndex("uq_submission").on(t.eventId, t.destinationId, t.payloadHash)],
);

/** Simple platform-wide key/value settings (e.g. the active model). */
export const appSettings = mysqlTable("app_settings", {
  key: varchar("key", { length: 80 }).primaryKey(),
  value: text("value"),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
});
