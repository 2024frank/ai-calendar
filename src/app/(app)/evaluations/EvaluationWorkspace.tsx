"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Card, TableShell } from "@/components/ui";
import { MAX_EVALUATION_BYTES, validateEvaluation, type EvaluationInput, type EvaluationReport } from "@/lib/evaluation";

type Detail = { id: number; title: string; createdAt: string; createdBy: number | null; creator: { id: number; email: string; name: string | null }; snapshot: EvaluationInput; report: EvaluationReport };

function sample(sourceId: number) {
  return JSON.stringify({
    version: 1, sourceId, title: "SYNTHETIC EXAMPLE — replace before retaining",
    period: { start: "2026-09-01T00:00:00Z", end: "2026-10-01T00:00:00Z" },
    scope: { description: "Replace with source pages, event types and inclusion rules; period includes start, excludes end", referenceCompleteness: "unknown", confirmed: true },
    provenance: {
      reference: { description: "Replace with independent reference collector and archived document identifier", capturedAt: "2026-09-01T10:00:00Z", independent: true },
      extracted: { description: "Replace with extraction run or exported file identifier", capturedAt: "2026-09-01T11:00:00Z" },
    },
    reference: [{ id: "ref-A", title: "Example concert", startTime: "2026-09-10T18:00:00Z", location: "Hall" }],
    extracted: [{ id: "ext-A", title: "Example concert", startTime: "2026-09-10T18:00:00Z", location: "Park" }],
    matches: [{ referenceId: "ref-A", extractedId: "ext-A" }], humanConfirmedMatches: true,
  }, null, 2);
}

export function EvaluationWorkspace({ sources, evaluations }: { sources: { id: number; name: string }[]; evaluations: { id: number; title: string; createdAt: string }[] }) {
  const router = useRouter();
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? 0);
  const [json, setJson] = useState("");
  const [scopeConfirmed, setScopeConfirmed] = useState(false);
  const [matchesConfirmed, setMatchesConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState<Detail | null>(null);

  async function open(id: number) {
    setError(""); setBusy(true);
    try {
      const response = await fetch(`/api/evaluations/${id}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not load comparison");
      setDetail(body);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load comparison"); }
    finally { setBusy(false); }
  }

  async function save() {
    setError(""); setBusy(true);
    try {
      if (!scopeConfirmed || !matchesConfirmed) throw new Error("Confirm the scope, independent reference and matches first.");
      if (new TextEncoder().encode(json).byteLength > MAX_EVALUATION_BYTES) throw new Error("File exceeds 1 MB.");
      const input = validateEvaluation(JSON.parse(json));
      if (input.sourceId !== sourceId) throw new Error("JSON sourceId must match the selected source.");
      const response = await fetch("/api/evaluations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not retain comparison");
      setScopeConfirmed(false); setMatchesConfirmed(false);
      router.refresh();
      await open(body.id);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not retain comparison"); }
    finally { setBusy(false); }
  }

  return <div className="grid" style={{ gap: 20, minWidth: 0, overflowWrap: "anywhere" }}>
    {error && <Alert tone="danger" title="Comparison not completed">{error}</Alert>}
    <Card style={{ minWidth: 0 }}>
      <h2>Import a comparison</h2>
      <p className="muted">JSON only, up to 1 MB and 500 occurrences per snapshot. Each row needs a unique ID, title and ISO startTime with a timezone offset; optional endTime, location and url are compared exactly. Missing optional values are null. Each occurrence start must lie within the declared period. URLs are retained as text only.</p>
      <p className="muted">Declare whether the reference is complete, partial or unknown for the exact source/time scope. Record independent collection provenance and both capture times. Enter one-to-one pairs in matches after checking each pair yourself; an empty matches list is allowed. Retained records cannot be edited here; retain a new comparison to correct one.</p>
      <div className="grid" style={{ gap: 12, minWidth: 0 }}>
        <label style={{ minWidth: 0 }}><span className="label">Source in the selected community</span>
          <select className="input" value={sourceId} onChange={(e) => { setSourceId(Number(e.target.value)); setScopeConfirmed(false); setMatchesConfirmed(false); }} style={{ width: "100%", minWidth: 0, maxWidth: "100%" }}>
            {sources.map((source) => <option key={source.id} value={source.id}>{source.name} (ID {source.id})</option>)}
          </select>
        </label>
        <div className="row" style={{ flexWrap: "wrap", gap: 12 }}>
          <Button disabled={!sourceId || busy} onClick={() => { setJson(sample(sourceId)); setScopeConfirmed(false); setMatchesConfirmed(false); }}>Load synthetic sample</Button>
          <a download="evaluation-sample.json" href={`data:application/json;charset=utf-8,${encodeURIComponent(sample(sourceId))}`}>Download sample JSON</a>
        </div>
        <label style={{ minWidth: 0 }}><span className="label">Upload JSON</span>
          <input type="file" accept="application/json,.json" style={{ maxWidth: "100%", minWidth: 0 }} disabled={busy} onChange={async (e) => {
            const file = e.target.files?.[0]; if (!file) return;
            setError(""); setScopeConfirmed(false); setMatchesConfirmed(false);
            if (file.size > MAX_EVALUATION_BYTES) { setError("File exceeds 1 MB."); return; }
            try { setJson(await file.text()); } catch { setError("Could not read this file."); }
          }} />
        </label>
        <label style={{ minWidth: 0 }}><span className="label">Snapshot JSON</span>
          <textarea className="input" value={json} onChange={(e) => { setJson(e.target.value); setScopeConfirmed(false); setMatchesConfirmed(false); }} rows={16} maxLength={MAX_EVALUATION_BYTES} spellCheck={false} style={{ width: "100%", minWidth: 0, maxWidth: "100%", fontFamily: "monospace", fontSize: 12, overflowWrap: "anywhere" }} />
        </label>
        <label className="row"><input type="checkbox" checked={scopeConfirmed} onChange={(e) => setScopeConfirmed(e.target.checked)} /> I confirm the declared source/time scope, completeness and independently collected reference provenance.</label>
        <label className="row"><input type="checkbox" checked={matchesConfirmed} onChange={(e) => setMatchesConfirmed(e.target.checked)} /> I checked every match myself; the matches are human assertions, not automatic scoring.</label>
        <Button variant="primary" disabled={!sourceId || !json || !scopeConfirmed || !matchesConfirmed} loading={busy} onClick={save}>Retain comparison</Button>
      </div>
    </Card>
    <Card style={{ minWidth: 0 }}>
      <h2>Retained comparisons</h2>
      <p className="muted">Latest 100 in the selected community.</p>
      {evaluations.length === 0 ? <p>No comparisons retained yet.</p> : <ul>{evaluations.map((row) => <li key={row.id}><Button variant="ghost" style={{ maxWidth: "100%", minWidth: 0, textAlign: "left" }} disabled={busy} onClick={() => open(row.id)}>{row.title} — #{row.id}</Button> <span className="muted">{row.createdAt.slice(0, 10)}</span></li>)}</ul>}
    </Card>
    {detail && <Card style={{ minWidth: 0 }}>
      <h2>{detail.title}</h2>
      <p>Retained {detail.createdAt} · Creator: {detail.creator.name || detail.creator.email} (ID {detail.creator.id}) · Source ID {detail.snapshot.sourceId}</p>
      <a href={`/api/evaluations/${detail.id}?download=1`}>Export retained evidence JSON</a>
      <p>{detail.snapshot.scope.description}</p>
      <p>Period: {detail.snapshot.period.start} to {detail.snapshot.period.end} (end excluded).</p>
      <p>Reference: {detail.snapshot.provenance.reference.description} · captured {detail.snapshot.provenance.reference.capturedAt}</p>
      <p>Extraction: {detail.snapshot.provenance.extracted.description} · captured {detail.snapshot.provenance.extracted.capturedAt}</p>
      <h3>Reference coverage: {detail.report.referenceCoveragePct === null ? "Unavailable (empty reference)" : `${detail.report.referenceCoveragePct}%`}</h3>
      <p>{detail.report.confirmedMatchCount} confirmed matches / {detail.report.referenceCount} reference occurrences · Reference declared {detail.report.referenceCompleteness}.</p>
      <Alert tone="warning">{detail.report.caveat}</Alert>
      <h3>Human-confirmed matches and exact field differences</h3>
      <TableShell label="Human-confirmed field comparison"><table className="tbl" style={{ tableLayout: "fixed", minWidth: 0 }}><thead><tr><th style={{ width: "35%" }}>Reference → extracted ID</th><th>Differences</th></tr></thead><tbody>
        {detail.report.matches.map((match) => <tr key={match.referenceId}><td>{match.referenceId} → {match.extractedId}</td><td>{match.differences.length ? <ul>{match.differences.map((diff) => <li key={diff.field}>{diff.field}: {JSON.stringify(diff.reference)} → {JSON.stringify(diff.extracted)}</li>)}</ul> : "No differences in compared fields"}</td></tr>)}
      </tbody></table></TableShell>
      <h3>Reference only ({detail.report.referenceOnly.length})</h3>
      <ul>{detail.report.referenceOnly.map((row) => <li key={row.id}>{row.id}: {row.title} · {row.startTime}</li>)}</ul>
      <h3>Extracted only ({detail.report.extractedOnly.length}) — not proven false positives</h3>
      <ul>{detail.report.extractedOnly.map((row) => <li key={row.id}>{row.id}: {row.title} · {row.startTime}</li>)}</ul>
    </Card>}
  </div>;
}
