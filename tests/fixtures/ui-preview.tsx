import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { AppShell } from "../../src/components/AppShell";
import { Nav } from "../../src/components/Nav";
import { CommunitySwitcher } from "../../src/components/CommunitySwitcher";
import { LiveTimeline } from "../../src/app/(app)/runs/[id]/LiveTimeline";
import { RunStatus } from "../../src/components/bits";
import { Alert, Button, Card, PageHeader, TableShell, ThemeToggle } from "../../src/components/ui";
import { usePathname } from "./next-navigation";
import { PilotWorkflowPreview } from "./pilot-workflows";
import "../../src/app/globals.css";

const communities = [{ id: 1, name: "Oberlin (fixture)" }, { id: 2, name: "Cleveland (fixture)" }];
const scenarios = [
  { id: 1, name: "Completed run", status: "completed", phase: null },
  { id: 2, name: "Live run", status: "running", phase: null },
  { id: 3, name: "Network outage / bounded retry", status: "running", phase: null },
  { id: 4, name: "Expired session", status: "running", phase: null },
  { id: 5, name: "Waiting for callback", status: "running", phase: "awaiting_callback" },
  { id: 6, name: "Missing run", status: "completed", phase: null },
  { id: 7, name: "Queued run", status: "running", phase: "queued" },
];

function Preview() {
  const [community, setCommunity] = useState({ activeId: 1, pending: 12 });
  const [scenarioId, setScenarioId] = useState(1);
  const pathname = usePathname();
  const scenario = scenarios.find((item) => item.id === scenarioId)!;

  useEffect(() => {
    const load = () => { void fetch("/__fixture/state").then((response) => response.json()).then(setCommunity); };
    load();
    window.addEventListener("fixture:refresh", load);
    return () => window.removeEventListener("fixture:refresh", load);
  }, []);

  const sidebar = <aside className="side" id="app-sidebar" aria-label="Primary navigation">
    <div className="brand"><Image src="/brand/communityhub-wordmark.png" alt="CommunityHub" width={1662} height={255} priority /><div className="brand__product">AI Calendar</div></div>
    <Nav key={`${community.activeId}:${community.pending}`} role="platform_admin" pending={community.pending} />
    <CommunitySwitcher communities={communities} activeId={community.activeId} />
    <div className="side__spacer" />
    <div className="account-card"><div className="account-card__top"><span className="account-card__avatar">T</span><div className="account-card__copy"><strong>Test user</strong><span>Platform admin</span></div><ThemeToggle /></div></div>
  </aside>;

  return <AppShell sidebar={sidebar}>
    <div className="grid" style={{ gap: 22 }}>
      <Alert tone="info">UI test fixture. Synthetic data only. This checks real components, not production data or authentication.</Alert>
      <nav className="row" style={{ flexWrap: "wrap" }} aria-label="Preview scenarios"><Link href="/dashboard">Dashboard fixture</Link><Link href="/review">Review workflows</Link><Link href="/evaluations">Research comparisons</Link></nav>
      {["/review", "/evaluations"].includes(pathname) ? <PilotWorkflowPreview kind={pathname === "/review" ? "review" : "evaluations"} /> : <>
      <PageHeader eyebrow="Workspace overview" title={pathname === "/dashboard" ? "Dashboard" : "Component preview"} description={`Selected community: ${communities.find((item) => item.id === community.activeId)?.name}`} actions={<Button icon="plus">Add source (fixture)</Button>} />
      <section className="kpi-grid" aria-label="Workspace metrics">
        {[["Active Sources", 12, "Enabled for extraction"], ["Pending Review", community.pending, "Needs a decision"], ["Duplicates", 23, "Protected from republishing"], ["Approved", 8, "Reviewer approved"], ["Auto-sent", 0, "Sent to CommunityHub for review"]].map(([label, count, hint]) => <Card className="kpi-card" key={label}><div className="kpi-card__top">{label}</div><div className="kpi">{count}</div><div className="kpi-card__hint">{hint}</div></Card>)}
      </section>
      <Card className="surface--flush"><div className="section-header" style={{ padding: "18px 20px 4px" }}><div><h2>Recent Runs</h2><p>Sample extraction activity for layout checks.</p></div></div><TableShell label="Recent agent runs"><table className="tbl"><thead><tr><th>Run</th><th>Source</th><th>Status</th><th>Found</th><th>Started</th></tr></thead><tbody>{[["#101", "Allen Memorial Art Museum", "completed", null], ["#102", "Riverdog Music", "running", "awaiting_callback"]].map(([id, source, status, phase]) => <tr key={id}><td>{id}</td><td>{source}</td><td><RunStatus status={status!} phase={phase} /></td><td>3</td><td>Sep 5, 10:00 AM</td></tr>)}</tbody></table></TableShell></Card>
      <Card>
        <label className="label" htmlFor="timeline-scenario">Timeline test scenario</label>
        <select id="timeline-scenario" className="input" value={scenarioId} onChange={(event) => setScenarioId(Number(event.target.value))} style={{ marginBottom: 20 }}>
          {scenarios.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <LiveTimeline key={scenario.id} runId={scenario.id} timeZone="America/New_York" initialStatus={scenario.status} initialPhase={scenario.phase} initialTokens={{ prompt: 1200, completion: 350 }} />
      </Card>
      </>}
    </div>
  </AppShell>;
}

const savedTheme = window.localStorage.getItem("ai-calendar-theme");
const theme = savedTheme === "dark" || (!savedTheme && window.matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light";
document.documentElement.dataset.theme = theme;
document.documentElement.style.colorScheme = theme;
createRoot(document.getElementById("root")!).render(<Preview />);
