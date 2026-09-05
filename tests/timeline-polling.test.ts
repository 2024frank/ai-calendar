import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LiveTimeline } from "../src/app/(app)/runs/[id]/LiveTimeline";
import { startTimelinePolling, type TimelineConnection, type TimelineSnapshot } from "../src/app/(app)/runs/[id]/timelinePolling";

function snapshot(overrides: Partial<TimelineSnapshot> = {}): TimelineSnapshot {
  return { events: [], nextAfter: 0, status: "running", terminal: false, tokens: { prompt: 0, completion: 0 }, ...overrides };
}

test("completed run has its true status and token usage before the timeline loads", () => {
  const markup = renderToStaticMarkup(createElement(LiveTimeline, {
    runId: 1,
    timeZone: "America/New_York",
    initialStatus: "completed",
    initialTokens: { prompt: 100, completion: 25 },
  }));
  assert.match(markup, />completed</);
  assert.match(markup, /125 tokens/);
  assert.doesNotMatch(markup, />Live</);
  assert.match(markup, /Loading timeline/);
});

test("waiting callback has an explicit status before the first poll", () => {
  const markup = renderToStaticMarkup(createElement(LiveTimeline, {
    runId: 1,
    timeZone: "America/New_York",
    initialStatus: "running",
    initialPhase: "awaiting_callback",
    initialTokens: { prompt: 0, completion: 0 },
  }));
  assert.match(markup, /Waiting for results/);
  assert.doesNotMatch(markup, />Live</);
});

test("terminal snapshot stops polling after loading the recorded history", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  const received: TimelineSnapshot[] = [];
  const stop = startTimelinePolling({
    runId: 1,
    fetcher: async () => { calls++; return Response.json(snapshot({ status: "completed", terminal: true })); },
    onSnapshot: (data) => received.push(data),
    onConnection: () => {},
  });
  t.after(stop);
  await setImmediate();
  t.mock.timers.tick(60_000);
  await setImmediate();
  assert.equal(calls, 1);
  assert.equal(received[0]?.status, "completed");
});

test("temporary failures back off and resume from the last recorded event", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const urls: string[] = [];
  const connections: TimelineConnection[] = [];
  const stop = startTimelinePolling({
    runId: 7,
    fetcher: async (url) => {
      urls.push(String(url));
      if (urls.length === 2) throw new Error("offline");
      return Response.json(snapshot({ nextAfter: 42, terminal: urls.length === 3 }));
    },
    onSnapshot: () => {},
    onConnection: (connection) => connections.push(connection),
  });
  t.after(stop);
  await setImmediate();
  t.mock.timers.tick(1_000);
  await setImmediate();
  assert.equal(connections.at(-1)?.state, "reconnecting");
  t.mock.timers.tick(1_000);
  await setImmediate();
  assert.equal(urls.length, 2);
  t.mock.timers.tick(1_000);
  await setImmediate();
  assert.deepEqual(urls, ["/api/runs/7/events?after=0", "/api/runs/7/events?after=42", "/api/runs/7/events?after=42"]);
  assert.equal(connections.at(-1)?.state, "connected");
});

test("expired sessions pause immediately with a sign-in action", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  const connections: TimelineConnection[] = [];
  const stop = startTimelinePolling({
    runId: 1,
    fetcher: async () => { calls++; return new Response(null, { status: 401 }); },
    onSnapshot: () => assert.fail("Unauthorized response must not update the timeline"),
    onConnection: (connection) => connections.push(connection),
  });
  t.after(stop);
  await setImmediate();
  t.mock.timers.tick(60_000);
  await setImmediate();
  assert.equal(calls, 1);
  assert.equal(connections.at(-1)?.state, "paused");
  assert.equal(connections.at(-1)?.requiresLogin, true);
});

test("five consecutive failures pause instead of polling forever", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  const connections: TimelineConnection[] = [];
  const stop = startTimelinePolling({
    runId: 1,
    fetcher: async () => { calls++; throw new Error("offline"); },
    onSnapshot: () => {},
    onConnection: (connection) => connections.push(connection),
  });
  t.after(stop);
  await setImmediate();
  for (const delay of [2_000, 4_000, 8_000, 15_000]) {
    t.mock.timers.tick(delay);
    await setImmediate();
  }
  assert.equal(calls, 5);
  assert.equal(connections.at(-1)?.state, "paused");
  t.mock.timers.tick(120_000);
  await setImmediate();
  assert.equal(calls, 5);
});

test("leaving a run aborts its request without updating the next screen", async () => {
  let signal: AbortSignal | null | undefined;
  let updates = 0;
  const stop = startTimelinePolling({
    runId: 1,
    fetcher: (_url, init) => {
      signal = init?.signal;
      return new Promise<Response>((_resolve, reject) => signal?.addEventListener("abort", () => reject(new Error("aborted"))));
    },
    onSnapshot: () => { updates++; },
    onConnection: () => { updates++; },
  });
  stop();
  await setImmediate();
  assert.equal(signal?.aborted, true);
  assert.equal(updates, 0);
});

test("a request that hangs is aborted at the deadline and then retried", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const signals: AbortSignal[] = [];
  const connections: TimelineConnection[] = [];
  const stop = startTimelinePolling({
    runId: 1,
    fetcher: (_url, init) => {
      const signal = init?.signal as AbortSignal;
      signals.push(signal);
      return new Promise<Response>((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
    },
    onSnapshot: () => {},
    onConnection: (connection) => connections.push(connection),
  });
  t.after(stop);
  t.mock.timers.tick(15_000);
  await setImmediate();
  assert.equal(signals[0].aborted, true);
  assert.equal(connections.at(-1)?.state, "reconnecting");
  t.mock.timers.tick(2_000);
  await setImmediate();
  assert.equal(signals.length, 2);
});
