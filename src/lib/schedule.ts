/** Human-facing schedule choices. Cron never reaches the UI. */
export const SCHEDULE_OPTIONS = [
  { value: "manual", label: "Manual only", cron: null as string | null },
  { value: "twice_daily", label: "Twice a day", cron: "0 6,18 * * *" },
  { value: "daily", label: "Every day", cron: "0 6 * * *" },
  { value: "every_3_days", label: "Every 3 days", cron: "0 6 */3 * *" },
  { value: "weekdays", label: "Every weekday", cron: "0 6 * * 1-5" },
  { value: "weekly", label: "Every week", cron: "0 6 * * 1" },
] as const;

export type ScheduleValue = (typeof SCHEDULE_OPTIONS)[number]["value"];

export function valueToCron(value: string): string | null {
  return SCHEDULE_OPTIONS.find((o) => o.value === value)?.cron ?? null;
}

export function cronToValue(cron: string | null | undefined): ScheduleValue {
  if (!cron) return "manual";
  const hit = SCHEDULE_OPTIONS.find((o) => o.cron === cron);
  return (hit?.value ?? "custom") as ScheduleValue;
}

/** Friendly description for any cron, including ones we didn't generate. */
export function cronToLabel(cron: string | null | undefined): string {
  if (!cron) return "Manual only";
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

/** How far ahead the agent looks for events, per source. */
export const LOOKAHEAD_OPTIONS = [
  { value: 7, label: "1 week ahead" },
  { value: 14, label: "2 weeks ahead (default)" },
  { value: 30, label: "1 month ahead" },
  { value: 90, label: "3 months ahead" },
  { value: 365, label: "Up to a year ahead" },
] as const;
