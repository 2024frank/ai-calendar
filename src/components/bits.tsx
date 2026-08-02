import type { ReactNode } from "react";
import { StatusBadge, type StatusTone } from "@/components/ui";

/** Product-wide timezone until per-community formatting is available in every query. */
export const APP_TZ = "America/New_York";

const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>();

export function fmtDate(value: unknown, timeZone = APP_TZ) {
  if (!value) return "—";
  const date = new Date(value as string);
  if (Number.isNaN(date.getTime())) return "—";
  let formatter = dateTimeFormatters.get(timeZone);
  if (!formatter) {
    try {
      formatter = new Intl.DateTimeFormat("en-US", {
        timeZone,
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    } catch {
      formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: APP_TZ,
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    }
    dateTimeFormatters.set(timeZone, formatter);
  }
  return formatter.format(date);
}

export function Badge({ kind, children }: { kind?: string; children: ReactNode }) {
  const tones: Record<string, StatusTone> = {
    good: "success",
    warn: "warning",
    bad: "danger",
    neutral: "neutral",
  };
  return <StatusBadge tone={tones[kind ?? ""] ?? "info"}>{children}</StatusBadge>;
}

const RUN: Record<string, StatusTone> = {
  running: "warning",
  completed: "success",
  failed: "danger",
  stopped: "neutral",
};
export function RunStatus({ status, phase }: { status: string; phase?: string | null }) {
  const queued = status === "running" && phase === "queued";
  return (
    <StatusBadge tone={queued ? "neutral" : (RUN[status] ?? "neutral")}>
      {queued ? "queued" : status}
    </StatusBadge>
  );
}

const DISCOVERY: Record<string, StatusTone> = {
  ready: "success",
  pending: "neutral",
  discovering: "warning",
  failed: "danger",
  stale: "warning",
};
export function DiscoveryStatus({ status }: { status: string }) {
  return <StatusBadge tone={DISCOVERY[status] ?? "neutral"}>{status}</StatusBadge>;
}

const EVENT: Record<string, StatusTone> = {
  pending: "warning",
  approved: "success",
  submitted: "success",
  rejected: "danger",
  duplicate: "neutral",
  auto_rejected: "danger",
};
export function EventStatus({ status }: { status: string }) {
  return <StatusBadge tone={EVENT[status] ?? "neutral"}>{status.replaceAll("_", " ")}</StatusBadge>;
}
