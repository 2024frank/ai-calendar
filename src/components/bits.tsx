export function fmtDate(d: unknown) {
  if (!d) return "—";
  const dt = new Date(d as string);
  if (isNaN(dt.getTime())) return "—";
  return dt.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function Badge({ kind, children }: { kind?: string; children: React.ReactNode }) {
  return <span className={`badge ${kind ?? ""}`}>{children}</span>;
}

const RUN: Record<string, string> = {
  running: "warn",
  completed: "good",
  failed: "bad",
  stopped: "neutral",
};
export function RunStatus({ status }: { status: string }) {
  return <Badge kind={RUN[status] ?? "neutral"}>{status}</Badge>;
}

const DISC: Record<string, string> = {
  ready: "good",
  pending: "neutral",
  discovering: "warn",
  failed: "bad",
  stale: "warn",
};
export function DiscoveryStatus({ status }: { status: string }) {
  return <Badge kind={DISC[status] ?? "neutral"}>{status}</Badge>;
}

const EV: Record<string, string> = {
  pending: "warn",
  approved: "good",
  submitted: "good",
  rejected: "bad",
  duplicate: "neutral",
  auto_rejected: "bad",
};
export function EventStatus({ status }: { status: string }) {
  return <Badge kind={EV[status] ?? "neutral"}>{status.replace("_", " ")}</Badge>;
}
