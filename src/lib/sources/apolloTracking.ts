import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { filmRunsForTracking } from "./apolloSegments";
import type { VeeziFilm } from "./veezi";

export type TrackedRun = { openedOn: string; endedOn: string | null };

/**
 * Veezi only publishes a rolling window of dates, so a single fetch cannot tell
 * you when a film actually opened or whether it truly ends.
 *
 * Two things are only knowable across runs:
 *  - opened_on: the earliest date ever seen, kept from the first run that saw
 *    the film. Today's window alone would claim it "starts" today.
 *  - ended_on: a film's real end is confirmed only when it DISAPPEARS from a
 *    later run. Until then its last visible date is just the edge of the
 *    window, and asserting it as an end would be inventing one.
 */
export async function trackFilmRuns(
  films: VeeziFilm[],
  now = new Date(),
): Promise<Map<string, TrackedRun>> {
  const runs = filmRunsForTracking(films, now);
  const out = new Map<string, TrackedRun>();
  if (!runs.length) return out;

  for (const r of runs) {
    await db.execute(
      sql`INSERT INTO apollo_film_runs (film_key, title, opened_on, last_seen_on, still_showing, ended_on)
          VALUES (${r.key}, ${r.title}, ${r.openedOn}, ${r.lastSeenOn}, 1, NULL)
          ON DUPLICATE KEY UPDATE
            title = VALUES(title),
            opened_on = LEAST(opened_on, VALUES(opened_on)),
            last_seen_on = GREATEST(last_seen_on, VALUES(last_seen_on)),
            still_showing = 1,
            ended_on = NULL`,
    );
  }

  // Anything that was showing and is no longer listed has genuinely ended, and
  // its last seen date is the real end.
  const keys = runs.map((r) => r.key);
  await db.execute(
    sql`UPDATE apollo_film_runs
        SET ended_on = last_seen_on, still_showing = 0
        WHERE still_showing = 1 AND film_key NOT IN (${sql.join(
          keys.map((k) => sql`${k}`),
          sql`, `,
        )})`,
  );

  const rows = (await db.execute(
    sql`SELECT film_key, DATE_FORMAT(opened_on, '%Y-%m-%d') opened_on,
               DATE_FORMAT(ended_on, '%Y-%m-%d') ended_on
        FROM apollo_film_runs
        WHERE film_key IN (${sql.join(
          keys.map((k) => sql`${k}`),
          sql`, `,
        )})`,
  )) as unknown as [{ film_key: string; opened_on: string; ended_on: string | null }[], unknown];

  for (const row of rows[0] ?? []) {
    out.set(row.film_key, { openedOn: row.opened_on, endedOn: row.ended_on });
  }
  return out;
}
