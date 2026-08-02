/** Human-facing schedule choices. Cron never reaches the UI. */
export const SCHEDULE_OPTIONS = [
  { value: "manual", label: "Manual only", cron: null as string | null },
  { value: "daily", label: "Every day", cron: "0 6 * * *" },
  { value: "every_3_days", label: "Every 3 days", cron: "0 6 */3 * *" },
  { value: "weekdays", label: "Every weekday", cron: "0 6 * * 1-5" },
  { value: "weekly", label: "Every week", cron: "0 6 * * 1" },
] as const;

export type ScheduleValue = (typeof SCHEDULE_OPTIONS)[number]["value"];

const MIN_INTERVAL_SECS: Record<string, number> = {
  daily: 22 * 3600,
  weekdays: 22 * 3600,
  every_3_days: 65 * 3600,
  weekly: 160 * 3600,
};

export function valueToCron(value: string): string | null {
  return SCHEDULE_OPTIONS.find((o) => o.value === value)?.cron ?? null;
}

export function cronToValue(cron: string | null | undefined): ScheduleValue {
  if (!cron) return "manual";
  // The current Vercel Hobby scheduler can invoke this project only once per
  // day. Treat old twice-daily rows honestly as daily rather than continuing to
  // promise a cadence the host cannot execute.
  if (cron === "0 6,18 * * *") return "daily";
  const hit = SCHEDULE_OPTIONS.find((o) => o.cron === cron);
  return (hit?.value ?? "custom") as ScheduleValue;
}

/** Friendly description for any cron, including ones we didn't generate. */
export function cronToLabel(cron: string | null | undefined): string {
  if (!cron) return "Manual only";
  if (cron === "0 6,18 * * *") return "Every day";
  const known = SCHEDULE_OPTIONS.find((o) => o.cron === cron);
  if (known) return known.label;

  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return "Custom schedule";
  const [min, hour, dom, , dow] = parts;

  const at = (() => {
    const h = Number(hour);
    if (!Number.isFinite(h)) return "";
    const suffix = h < 12 ? "am" : "pm";
    const h12 = h % 12 === 0 ? 12 : h % 12;
    const m = Number(min);
    return ` at ${h12}${m ? `:${String(m).padStart(2, "0")}` : ""}${suffix}`;
  })();

  const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  if (dow !== "*" && /^\d$/.test(dow)) return `Every ${DAYS[Number(dow)]}${at}`;
  if (dow === "1-5") return `Every weekday${at}`;
  if (dom.startsWith("*/")) return `Every ${dom.slice(2)} days${at}`;
  if (dom === "*" && dow === "*") return `Every day${at}`;
  return "Custom schedule";
}

/** Evaluate the supported calendar choices from the last successful extraction. */
export function scheduledSourceIsDue(
  cron: string | null | undefined,
  lastCompletedAt: Date | string | null | undefined,
  nowMs = Date.now(),
  timeZone = "America/New_York",
): boolean {
  if (!cron) return false;
  const schedule = cronToValue(cron);
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(
    new Date(nowMs),
  );
  if (schedule === "weekdays" && (weekday === "Sat" || weekday === "Sun")) return false;
  if (schedule === "weekly" && weekday !== "Mon") return false;

  if (!lastCompletedAt) return true;
  const lastMs = new Date(lastCompletedAt).getTime();
  if (!Number.isFinite(lastMs)) return true;
  const interval = MIN_INTERVAL_SECS[schedule] ?? 22 * 3600;
  return nowMs - lastMs >= interval * 1000;
}

/** How far ahead the agent looks for events, per source. */
export const LOOKAHEAD_OPTIONS = [
  { value: 7, label: "1 week ahead" },
  { value: 14, label: "2 weeks ahead (default)" },
  { value: 30, label: "1 month ahead" },
  { value: 90, label: "3 months ahead" },
  { value: 365, label: "Up to a year ahead" },
] as const;
