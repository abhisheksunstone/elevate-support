import { useState, useEffect, useCallback } from "react";
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine } from "recharts";

const JIRA_BASE = "https://sunstonedev.atlassian.net/browse/";
const CLOUD_ID = "da340d2a-a707-4481-be7b-7bf60d05f7a3";
const SLA_FR_MIN = 30;

const TEAM = ["Akshay Pathak", "Suchismita Nayak", "Abhishek Singh", "abhishek singh", "Sai Sindhoora", "Isha Shrivastava", "Nishant Kamboj"];

const statusColor = {
  "Done": "#22c55e", "Pending": "#f59e0b", "Awaiting Customer Input": "#8b5cf6",
  "Open": "#ef4444", "Work in progress": "#3b82f6", "Waiting on Tech": "#06b6d4",
  "On Hold for Pickup": "#94a3b8", "Reopened": "#f97316",
};

const categoryColor = {
  // Demo categories
  "Hardware": "#6366f1",
  "Software": "#22c55e",
  "Access": "#f97316",
  "General": "#06b6d4",
  "Unknown": "#94a3b8",
  // Jira categories (current live data)
  "CRM": "#6366f1",
  "Acad Ops": "#22c55e",
  "Others": "#f97316",
  "Attendence": "#06b6d4",
  "LMS": "#ec4899",
};

const JiraLink = ({ issueKey }) => (
  <a href={JIRA_BASE + issueKey} target="_blank" rel="noopener noreferrer"
    style={{ color: "#818cf8", fontWeight: 700, textDecoration: "none", whiteSpace: "nowrap" }}
    onMouseEnter={e => { e.target.style.textDecoration = "underline"; }}
    onMouseLeave={e => { e.target.style.textDecoration = "none"; }}>
    {issueKey}
  </a>
);

function FRBadge({ mins }) {
  if (mins === null) return <span style={{ color: "#ef4444", fontWeight: 700, fontSize: 12 }}>No response</span>;
  const pass = mins <= SLA_FR_MIN;
  let display;
  if (mins < 1) display = "<1m";
  else if (mins < 60) display = `${Math.round(mins)}m`;
  else if (mins < 1440) display = `${(mins / 60).toFixed(1)}h`;
  else display = `${(mins / 1440).toFixed(1)}d`;
  return <span style={{ color: pass ? "#22c55e" : "#ef4444", fontWeight: 700, fontSize: 12 }}>{display}</span>;
}

function SLABadge({ mins }) {
  if (mins === null) return <span style={{ padding: "2px 8px", borderRadius: 6, fontSize: 11, fontWeight: 600, background: "#64748b22", color: "#94a3b8", border: "1px solid #64748b44" }}>No resp</span>;
  const pass = mins <= SLA_FR_MIN;
  return <span style={{ padding: "2px 8px", borderRadius: 6, fontSize: 11, fontWeight: 600,
    background: pass ? "#22c55e22" : "#ef444422", color: pass ? "#22c55e" : "#ef4444",
    border: `1px solid ${pass ? "#22c55e" : "#ef4444"}44` }}>{pass ? "Pass" : "Breach"}</span>;
}

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: "8px 14px", color: "#f1f5f9", fontSize: 13 }}>
        <div style={{ fontWeight: 600 }}>{label}</div>
        {payload.map((p, i) => <div key={i} style={{ color: p.color || "#94a3b8" }}>{p.name}: {p.value}</div>)}
      </div>
    );
  }
  return null;
};

// ——— Demo data (no API call) ———
function getDemoData(startDate, endDate) {
  const statuses = ["Done", "Done", "Done", "Work in progress", "Open", "Pending", "Awaiting Customer Input", "Waiting on Tech"];
  const labelsList = ["BUG", "Request", "Not_A_BUG", "Request", "BUG", "Unlabeled"];
  const categories = ["Hardware", "Software", "Access", "General", "Hardware", "Software"];
  const summaries = [
    "Login failure after password reset", "Laptop not connecting to VPN", "Printer not responding",
    "Access request for Confluence space", "Outlook calendar sync issue", "New joiner setup pending",
    "Monitor flickering", "Software installation request", "Account locked - need unlock",
  ];
  const start = new Date(startDate);
  const end = new Date(endDate);
  const issues = [];
  for (let i = 0; i < 42; i++) {
    const dayOffset = Math.floor(i / 6);
    const created = new Date(start);
    created.setDate(start.getDate() + dayOffset);
    created.setHours(9 + (i % 6), (i % 4) * 15, 0, 0);
    if (created > end) break;
    const createdStr = created.toISOString();
    const frMins = i % 5 === 0 ? null : [15, 25, 45, 90, 120][i % 5];
    const firstTeamCommentDate = frMins == null ? null : new Date(created.getTime() + frMins * 60000).toISOString();
    const isDone = statuses[i % statuses.length] === "Done";
    const statuscategorychangedate = isDone ? new Date(created.getTime() + (2 + (i % 3)) * 24 * 3600000).toISOString() : null;
    issues.push({
      key: `HLP-${100 + i}`,
      summary: summaries[i % summaries.length] + ` (${i})`,
      status: statuses[i % statuses.length],
      assignee: TEAM[i % TEAM.length],
      labels: [labelsList[i % labelsList.length]].filter(Boolean),
      category: categories[i % categories.length],
      created: createdStr,
      statuscategorychangedate,
      firstTeamCommentDate,
    });
  }
  return issues;
}

// ——— Jira via dev-server proxy (avoids CORS; credentials stay server-side) ———
async function fetchJiraViaProxy(startDate, endDate) {
  const url = `/api/jira-search?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`;
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error || `Request failed ${response.status}`);
  return Array.isArray(data) ? data : [];
}

function processData(rawIssues) {
  const tickets = rawIssues.map(issue => {
    let frMins = null;
    if (issue.created && issue.firstTeamCommentDate) {
      const created = new Date(issue.created);
      const firstResp = new Date(issue.firstTeamCommentDate);
      const diffMs = firstResp - created;
      frMins = Math.max(0, Math.round(diffMs / 60000));
    }

    const doneAt = issue.status === "Done" ? (issue.statuscategorychangedate || issue.updated) : null;
    let resHrs = null;
    if (issue.status === "Done" && issue.created && doneAt) {
      const created = new Date(issue.created);
      const resolved = new Date(doneAt);
      resHrs = Math.round((resolved - created) / 3600000 * 10) / 10;
    }

    return {
      key: issue.key,
      summary: issue.summary,
      status: issue.status,
      assignee: issue.assignee || "Unassigned",
      labels: issue.labels || [],
      category: issue.category || "Unknown",
      created: issue.created,
      frMins,
      resHrs,
      doneAt,
    };
  });

  // Status breakdown
  const statusMap = {};
  tickets.forEach(t => { statusMap[t.status] = (statusMap[t.status] || 0) + 1; });
  const statusData = Object.entries(statusMap).sort((a, b) => b[1] - a[1]).map(([name, value]) => ({
    name, value, color: statusColor[name] || "#94a3b8"
  }));

  // Label breakdown
  const labelMap = {};
  tickets.forEach(t => {
    const l = t.labels.length > 0 ? t.labels[0] : "Unlabeled";
    labelMap[l] = (labelMap[l] || 0) + 1;
  });
  const labelColors = { "BUG": "#ef4444", "Not_A_BUG": "#06b6d4", "Request": "#6366f1", "Unidentifed": "#f97316", "Unlabeled": "#94a3b8" };
  const labelData = Object.entries(labelMap).sort((a, b) => b[1] - a[1]).map(([name, value]) => ({
    name, value, color: labelColors[name] || "#8b5cf6"
  }));

  // Category breakdown
  const categoryMap = {};
  tickets.forEach(t => {
    const c = t.category || "Unknown";
    categoryMap[c] = (categoryMap[c] || 0) + 1;
  });
  const categoryData = Object.entries(categoryMap).sort((a, b) => b[1] - a[1]).map(([name, value]) => ({
    name, value, color: categoryColor[name] || "#8b5cf6"
  }));

  // FR buckets
  const frTimes = tickets.filter(t => t.frMins !== null).map(t => t.frMins);
  const noResp = tickets.filter(t => t.frMins === null).length;
  const bucket30 = frTimes.filter(t => t <= 30).length;
  const bucket60 = frTimes.filter(t => t > 30 && t <= 60).length;
  const bucket90 = frTimes.filter(t => t > 60 && t <= 90).length;
  const bucket120 = frTimes.filter(t => t > 90 && t <= 120).length;
  const bucket120plus = frTimes.filter(t => t > 120).length;

  const frBuckets = [
    { name: "≤30m", value: bucket30, color: "#22c55e" },
    { name: "31-60m", value: bucket60, color: "#f59e0b" },
    { name: "61-90m", value: bucket90, color: "#f97316" },
    { name: "91-120m", value: bucket120, color: "#ef4444" },
    { name: "120m+", value: bucket120plus, color: "#dc2626" },
    { name: "No Resp", value: noResp, color: "#64748b" },
  ].filter(b => b.value > 0);

  // Assignee workload (FR + resolution)
  const assigneeMap = {};
  tickets.forEach(t => {
    if (!assigneeMap[t.assignee]) assigneeMap[t.assignee] = { done: 0, open: 0, frList: [], resList: [] };
    if (t.status === "Done") assigneeMap[t.assignee].done++;
    else assigneeMap[t.assignee].open++;
    if (t.frMins !== null) assigneeMap[t.assignee].frList.push(t.frMins);
    if (t.resHrs !== null) assigneeMap[t.assignee].resList.push(t.resHrs);
  });
  const assigneeData = Object.entries(assigneeMap).sort((a, b) => (b[1].done + b[1].open) - (a[1].done + a[1].open)).map(([name, v]) => ({
    name: name.length > 15 ? name.substring(0, 13) + ".." : name,
    fullName: name, done: v.done, open: v.open,
    avgFR: v.frList.length > 0 ? v.frList.reduce((a, b) => a + b, 0) / v.frList.length : null,
    avgRes: v.resList.length > 0 ? v.resList.reduce((a, b) => a + b, 0) / v.resList.length : null,
  }));

  // Daily volume
  const dailyMap = {};
  tickets.forEach(t => {
    const d = t.created?.substring(0, 10);
    if (d) dailyMap[d] = (dailyMap[d] || 0) + 1;
  });
  const dailyData = Object.entries(dailyMap).sort().map(([date, tickets]) => ({
    date: new Date(date + "T00:00:00").toLocaleDateString("en-IN", { month: "short", day: "numeric" }),
    tickets
  }));

  // FR by assignee for bar chart (avg minutes)
  const assigneeFR = assigneeData.filter(a => a.avgFR !== null).map(a => ({ name: a.name, avg: Math.round(a.avgFR) }));

  // Resolution times (hours) for buckets and stats
  const resolved = tickets.filter(t => t.status === "Done").length;
  const resTimes = tickets.filter(t => t.resHrs !== null).map(t => t.resHrs);
  const avgRes = resTimes.length > 0 ? resTimes.reduce((a, b) => a + b, 0) / resTimes.length : 0;

  // Resolution time buckets (hours): ≤4h, 4-8h, 8-12h, 12-24h, 24-48h, 48-72h, 72h+
  const resBuckets = [
    { name: "≤4 hr", value: resTimes.filter(h => h <= 4).length, color: "#22c55e" },
    { name: "4hr-8hr", value: resTimes.filter(h => h > 4 && h <= 8).length, color: "#4ade80" },
    { name: "8hr-12hr", value: resTimes.filter(h => h > 8 && h <= 12).length, color: "#a3e635" },
    { name: "12hr-24hr", value: resTimes.filter(h => h > 12 && h <= 24).length, color: "#facc15" },
    { name: "24hr-48hr", value: resTimes.filter(h => h > 24 && h <= 48).length, color: "#f59e0b" },
    { name: "48hr-72hr", value: resTimes.filter(h => h > 48 && h <= 72).length, color: "#f97316" },
    { name: "72hr+", value: resTimes.filter(h => h > 72).length, color: "#ef4444" },
  ].filter(b => b.value > 0);

  // Resolution by assignee for bar chart (avg hours)
  const assigneeRes = assigneeData.filter(a => a.avgRes !== null).map(a => ({ name: a.name, avg: Math.round(a.avgRes * 10) / 10 }));

  // Summary stats
  const totalFR = frTimes.length;
  const within30 = bucket30;
  const medianFR = frTimes.length > 0 ? frTimes.sort((a, b) => a - b)[Math.floor(frTimes.length / 2)] : 0;

  return {
    tickets, statusData, labelData, categoryData, frBuckets, assigneeData, dailyData, assigneeFR, resBuckets, assigneeRes,
    stats: {
      total: tickets.length, resolved, open: tickets.length - resolved,
      medianFR, within30, totalFR, noResp, avgRes,
      passRate: totalFR > 0 ? Math.round(within30 / totalFR * 100) : 0,
    }
  };
}

export default function HLPDashboard() {
  const [tab, setTab] = useState("overview");
  const [startDate, setStartDate] = useState("2026-02-26");
  const [endDate, setEndDate] = useState("2026-03-09");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [dataSource, setDataSource] = useState("jira");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterAssignee, setFilterAssignee] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterLabel, setFilterLabel] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let raw;
      if (dataSource === "demo") {
        raw = getDemoData(startDate, endDate);
      } else {
        raw = await fetchJiraViaProxy(startDate, endDate);
      }
      const processed = processData(raw);
      setData(processed);
      setLastRefresh(new Date().toLocaleTimeString("en-IN"));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, dataSource]);

  useEffect(() => { loadData(); }, []);

  const d = data;
  const s = d?.stats;

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(145deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)", color: "#e2e8f0", fontFamily: "'Segoe UI', system-ui, sans-serif", padding: "24px 20px" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ width: 42, height: 42, borderRadius: 10, background: "linear-gradient(135deg, #6366f1, #8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, fontWeight: 800, color: "#fff" }}>H</div>
            <div>
              <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "#f8fafc" }}>HLP Helpdesk Dashboard</h1>
              <p style={{ margin: 0, fontSize: 12, color: "#64748b" }}>
                Live data from sunstonedev.atlassian.net {lastRefresh && `· Last refreshed: ${lastRefresh}`}
              </p>
            </div>
          </div>
        </div>

        {/* Filters Bar */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20, background: "#1e293b", borderRadius: 10, padding: "12px 16px", border: "1px solid #334155", flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <label style={{ fontSize: 12, color: "#94a3b8", fontWeight: 600 }}>Data</label>
            <select value={dataSource} onChange={e => setDataSource(e.target.value)}
              style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 6, padding: "6px 10px", color: "#e2e8f0", fontSize: 13, cursor: "pointer" }}>
              <option value="demo">Demo (no API)</option>
              <option value="jira">Jira API</option>
            </select>
          </div>
          {dataSource === "jira" && (
            <span style={{ fontSize: 12, color: "#64748b" }}>Using credentials from .env (server)</span>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <label style={{ fontSize: 12, color: "#94a3b8", fontWeight: 600 }}>FROM</label>
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
              style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 6, padding: "6px 10px", color: "#e2e8f0", fontSize: 13 }} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <label style={{ fontSize: 12, color: "#94a3b8", fontWeight: 600 }}>TO</label>
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
              style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 6, padding: "6px 10px", color: "#e2e8f0", fontSize: 13 }} />
          </div>
          <button onClick={loadData} disabled={loading}
            style={{ background: loading ? "#334155" : "#6366f1", color: "#fff", border: "none", borderRadius: 8, padding: "8px 20px", fontSize: 13, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: 6, transition: "all 0.2s" }}>
            {loading ? "Fetching..." : "Refresh Data"}
          </button>
          {s && <span style={{ fontSize: 12, color: "#64748b", marginLeft: "auto" }}>{dataSource === "demo" ? "Demo: " : ""}{s.total} tickets</span>}
        </div>

        {/* Error */}
        {error && (
          <div style={{ background: "#7f1d1d", borderRadius: 10, padding: "12px 16px", marginBottom: 16, border: "1px solid #991b1b", fontSize: 13, color: "#fca5a5" }}>
            Error fetching data: {error}. Try clicking Refresh again.
          </div>
        )}

        {/* Loading */}
        {loading && !d && (
          <div style={{ textAlign: "center", padding: "60px 0", color: "#94a3b8" }}>
            <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>{dataSource === "jira" ? "Fetching from Jira API..." : "Loading demo data..."}</div>
            <div style={{ fontSize: 13 }}>{dataSource === "jira" ? "Using Jira REST API" : "No API call"}</div>
          </div>
        )}

        {d && (
          <>
            {/* Tabs */}
            <div style={{ display: "flex", gap: 4, marginBottom: 20, background: "#1e293b", borderRadius: 10, padding: 4, width: "fit-content", border: "1px solid #334155" }}>
              {["overview", "FR Analysis", "Resolution Analysis", "All Tickets"].map(t => (
                <button key={t} onClick={() => setTab(t)} style={{
                  padding: "8px 18px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600,
                  background: tab === t ? "#6366f1" : "transparent", color: tab === t ? "#fff" : "#94a3b8", transition: "all 0.2s",
                }}>{t}</button>
              ))}
            </div>

            {/* ===== OVERVIEW ===== */}
            {tab === "overview" && (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(145px, 1fr))", gap: 12, marginBottom: 24 }}>
                  {[
                    { label: "Total Tickets", value: s.total, sub: "", accent: "#6366f1" },
                    { label: "Resolved", value: s.resolved, sub: `${s.total > 0 ? Math.round(s.resolved / s.total * 100) : 0}%`, accent: "#22c55e" },
                    { label: "Open", value: s.open, sub: `${s.total > 0 ? Math.round(s.open / s.total * 100) : 0}%`, accent: "#ef4444" },
                    { label: "FR SLA Pass", value: `${s.passRate}%`, sub: `${s.within30}/${s.totalFR} ≤30m`, accent: s.passRate >= 70 ? "#22c55e" : "#ef4444" },
                    { label: "Avg Resolution time", value: s.avgRes ? (s.avgRes < 24 ? `${s.avgRes.toFixed(1)}h` : `${(s.avgRes / 24).toFixed(1)}d`) : "—", sub: `created → marked Done`, accent: "#22c55e" },
                  ].map((kpi, i) => (
                    <div key={i} style={{ background: "#1e293b", borderRadius: 12, padding: "16px 18px", border: "1px solid #334155", position: "relative", overflow: "hidden" }}>
                      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: kpi.accent }} />
                      <div style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>{kpi.label}</div>
                      <div style={{ fontSize: 28, fontWeight: 800, color: "#f8fafc", marginTop: 4 }}>{kpi.value}</div>
                      {kpi.sub ? <div style={{ fontSize: 12, color: "#64748b" }}>{kpi.sub}</div> : null}
                    </div>
                  ))}
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
                  <div style={{ background: "#1e293b", borderRadius: 14, padding: 20, border: "1px solid #334155" }}>
                    <h3 style={{ margin: "0 0 14px 0", fontSize: 14, fontWeight: 700, color: "#cbd5e1" }}>Category-wise Distribution</h3>
                    <div style={{ display: "flex", alignItems: "center" }}>
                      <ResponsiveContainer width="55%" height={180}>
                        <PieChart><Pie data={d.categoryData} cx="50%" cy="50%" innerRadius={45} outerRadius={75} paddingAngle={3} dataKey="value" stroke="none">
                          {d.categoryData.map((e, i) => <Cell key={i} fill={e.color} />)}
                        </Pie></PieChart>
                      </ResponsiveContainer>
                      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                        {d.categoryData.map((s, i) => (
                          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                            <div style={{ width: 10, height: 10, borderRadius: 3, background: s.color, flexShrink: 0 }} />
                            <span style={{ color: "#94a3b8" }}>{s.name}</span>
                            <span style={{ color: "#e2e8f0", fontWeight: 700, marginLeft: "auto" }}>{s.value}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div style={{ background: "#1e293b", borderRadius: 14, padding: 20, border: "1px solid #334155" }}>
                    <h3 style={{ margin: "0 0 14px 0", fontSize: 14, fontWeight: 700, color: "#cbd5e1" }}>Issue Categories (Labels)</h3>
                    <div style={{ display: "flex", alignItems: "center" }}>
                      <ResponsiveContainer width="55%" height={180}>
                        <PieChart><Pie data={d.labelData} cx="50%" cy="50%" innerRadius={45} outerRadius={75} paddingAngle={3} dataKey="value" stroke="none">
                          {d.labelData.map((e, i) => <Cell key={i} fill={e.color} />)}
                        </Pie></PieChart>
                      </ResponsiveContainer>
                      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                        {d.labelData.map((s, i) => (
                          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                            <div style={{ width: 10, height: 10, borderRadius: 3, background: s.color, flexShrink: 0 }} />
                            <span style={{ color: "#94a3b8" }}>{s.name}</span>
                            <span style={{ color: "#e2e8f0", fontWeight: 700, marginLeft: "auto" }}>{s.value}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
                  <div style={{ background: "#1e293b", borderRadius: 14, padding: 20, border: "1px solid #334155" }}>
                    <h3 style={{ margin: "0 0 14px 0", fontSize: 14, fontWeight: 700, color: "#cbd5e1" }}>Daily Ticket Volume</h3>
                    <ResponsiveContainer width="100%" height={180}>
                      <BarChart data={d.dailyData} barSize={28}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                        <XAxis dataKey="date" tick={{ fill: "#94a3b8", fontSize: 10 }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
                        <Tooltip content={<CustomTooltip />} />
                        <Bar dataKey="tickets" fill="#6366f1" radius={[6, 6, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <div style={{ background: "#1e293b", borderRadius: 14, padding: 20, border: "1px solid #334155" }}>
                    <h3 style={{ margin: "0 0 14px 0", fontSize: 14, fontWeight: 700, color: "#cbd5e1" }}>Assignee Workload</h3>
                    <ResponsiveContainer width="100%" height={180}>
                      <BarChart data={d.assigneeData} layout="vertical" barSize={14}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
                        <XAxis type="number" tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
                        <YAxis type="category" dataKey="name" tick={{ fill: "#94a3b8", fontSize: 10 }} axisLine={false} tickLine={false} width={100} />
                        <Tooltip content={<CustomTooltip />} />
                        <Bar dataKey="done" stackId="a" fill="#22c55e" name="Done" />
                        <Bar dataKey="open" stackId="a" fill="#ef4444" radius={[0, 6, 6, 0]} name="Open" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </>
            )}

            {/* ===== FR ANALYSIS ===== */}
            {tab === "FR Analysis" && (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
                  {/* FR Bucket Pie */}
                  <div style={{ background: "#1e293b", borderRadius: 14, padding: 20, border: "1px solid #334155" }}>
                    <h3 style={{ margin: "0 0 14px 0", fontSize: 14, fontWeight: 700, color: "#cbd5e1" }}>First Response Distribution</h3>
                    <div style={{ display: "flex", alignItems: "center" }}>
                      <ResponsiveContainer width="55%" height={220}>
                        <PieChart><Pie data={d.frBuckets} cx="50%" cy="50%" innerRadius={50} outerRadius={85} paddingAngle={3} dataKey="value" stroke="none">
                          {d.frBuckets.map((e, i) => <Cell key={i} fill={e.color} />)}
                        </Pie></PieChart>
                      </ResponsiveContainer>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {d.frBuckets.map((b, i) => (
                          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                            <div style={{ width: 12, height: 12, borderRadius: 3, background: b.color, flexShrink: 0 }} />
                            <span style={{ color: "#94a3b8" }}>{b.name}</span>
                            <span style={{ color: "#e2e8f0", fontWeight: 700, marginLeft: "auto" }}>{b.value}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* FR Bucket Bar */}
                  <div style={{ background: "#1e293b", borderRadius: 14, padding: 20, border: "1px solid #334155" }}>
                    <h3 style={{ margin: "0 0 14px 0", fontSize: 14, fontWeight: 700, color: "#cbd5e1" }}>FR Bucket Breakdown (count)</h3>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={d.frBuckets} barSize={36}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                        <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                        <Tooltip content={<CustomTooltip />} />
                        <Bar dataKey="value" name="Tickets" radius={[6, 6, 0, 0]}>
                          {d.frBuckets.map((e, i) => <Cell key={i} fill={e.color} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* FR by Assignee */}
                <div style={{ background: "#1e293b", borderRadius: 14, padding: 20, border: "1px solid #334155", marginBottom: 16 }}>
                  <h3 style={{ margin: "0 0 14px 0", fontSize: 14, fontWeight: 700, color: "#cbd5e1" }}>Avg First Response by Assignee (minutes)</h3>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={d.assigneeFR} barSize={28}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                      <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
                      <Tooltip content={<CustomTooltip />} />
                      <ReferenceLine y={30} stroke="#ef4444" strokeDasharray="4 4" label={{ value: "30m SLA", fill: "#ef4444", fontSize: 10, position: "right" }} />
                      <Bar dataKey="avg" fill="#6366f1" radius={[6, 6, 0, 0]} name="Avg FR (min)" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                {/* FR Stats Cards */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
                  {[
                    { label: "≤30 min (SLA Pass)", value: s.within30, color: "#22c55e", total: s.totalFR },
                    { label: "31-60 min", value: d.frBuckets.find(b => b.name === "31-60m")?.value || 0, color: "#f59e0b", total: s.totalFR },
                    { label: "61-120 min", value: (d.frBuckets.find(b => b.name === "61-90m")?.value || 0) + (d.frBuckets.find(b => b.name === "91-120m")?.value || 0), color: "#f97316", total: s.totalFR },
                    { label: "No Response", value: s.noResp, color: "#ef4444", total: s.total },
                  ].map((card, i) => (
                    <div key={i} style={{ background: "#1e293b", borderRadius: 12, padding: 16, border: "1px solid #334155", textAlign: "center" }}>
                      <div style={{ fontSize: 32, fontWeight: 800, color: card.color }}>{card.value}</div>
                      <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>{card.label}</div>
                      <div style={{ fontSize: 11, color: "#64748b" }}>{card.total > 0 ? Math.round(card.value / card.total * 100) : 0}% of {card.total}</div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* ===== RESOLUTION ANALYSIS ===== */}
            {tab === "Resolution Analysis" && (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
                  <div style={{ background: "#1e293b", borderRadius: 14, padding: 20, border: "1px solid #334155" }}>
                    <h3 style={{ margin: "0 0 14px 0", fontSize: 14, fontWeight: 700, color: "#cbd5e1" }}>Resolution Time Distribution</h3>
                    <div style={{ display: "flex", alignItems: "center" }}>
                      <ResponsiveContainer width="55%" height={220}>
                        <PieChart><Pie data={d.resBuckets} cx="50%" cy="50%" innerRadius={50} outerRadius={85} paddingAngle={3} dataKey="value" stroke="none">
                          {d.resBuckets.map((e, i) => <Cell key={i} fill={e.color} />)}
                        </Pie></PieChart>
                      </ResponsiveContainer>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {d.resBuckets.map((b, i) => (
                          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                            <div style={{ width: 12, height: 12, borderRadius: 3, background: b.color, flexShrink: 0 }} />
                            <span style={{ color: "#94a3b8" }}>{b.name}</span>
                            <span style={{ color: "#e2e8f0", fontWeight: 700, marginLeft: "auto" }}>{b.value}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div style={{ background: "#1e293b", borderRadius: 14, padding: 20, border: "1px solid #334155" }}>
                    <h3 style={{ margin: "0 0 14px 0", fontSize: 14, fontWeight: 700, color: "#cbd5e1" }}>Resolution Bucket Breakdown (count)</h3>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={d.resBuckets} barSize={36}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                        <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                        <Tooltip content={<CustomTooltip />} />
                        <Bar dataKey="value" name="Tickets" radius={[6, 6, 0, 0]}>
                          {d.resBuckets.map((e, i) => <Cell key={i} fill={e.color} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div style={{ background: "#1e293b", borderRadius: 14, padding: 20, border: "1px solid #334155", marginBottom: 16 }}>
                  <h3 style={{ margin: "0 0 14px 0", fontSize: 14, fontWeight: 700, color: "#cbd5e1" }}>Avg Resolution by Assignee (hours)</h3>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={d.assigneeRes} barSize={28}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                      <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
                      <Tooltip content={<CustomTooltip />} />
                      <Bar dataKey="avg" fill="#22c55e" radius={[6, 6, 0, 0]} name="Avg Resolution (h)" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: 12 }}>
                  {[
                    { label: "≤4 hr", name: "≤4 hr", color: "#22c55e" },
                    { label: "4hr-8hr", name: "4hr-8hr", color: "#4ade80" },
                    { label: "8hr-12hr", name: "8hr-12hr", color: "#a3e635" },
                    { label: "12hr-24hr", name: "12hr-24hr", color: "#facc15" },
                    { label: "24hr-48hr", name: "24hr-48hr", color: "#f59e0b" },
                    { label: "48hr-72hr", name: "48hr-72hr", color: "#f97316" },
                    { label: "72hr+", name: "72hr+", color: "#ef4444" },
                  ].map((card, i) => (
                    <div key={i} style={{ background: "#1e293b", borderRadius: 12, padding: 16, border: "1px solid #334155", textAlign: "center" }}>
                      <div style={{ fontSize: 32, fontWeight: 800, color: card.color }}>{d.resBuckets.find(b => b.name === card.name)?.value || 0}</div>
                      <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>{card.label}</div>
                      <div style={{ fontSize: 11, color: "#64748b" }}>{s.resolved > 0 ? Math.round((d.resBuckets.find(b => b.name === card.name)?.value || 0) / s.resolved * 100) : 0}% of {s.resolved} resolved</div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* ===== ALL TICKETS ===== */}
            {tab === "All Tickets" && (() => {
              const filteredTickets = d.tickets.filter(t => {
                if (filterStatus && t.status !== filterStatus) return false;
                if (filterAssignee && t.assignee !== filterAssignee) return false;
                if (filterCategory && t.category !== filterCategory) return false;
                if (filterLabel && !(t.labels || []).includes(filterLabel)) return false;
                return true;
              });
              const uniqueStatuses = [...new Set(d.tickets.map(t => t.status).filter(Boolean))].sort();
              const uniqueAssignees = [...new Set(d.tickets.map(t => t.assignee).filter(Boolean))].sort();
              const uniqueCategories = [...new Set(d.tickets.map(t => t.category).filter(Boolean))].sort();
              const uniqueLabels = [...new Set(d.tickets.flatMap(t => t.labels || []).filter(Boolean))].sort();
              return (
              <div style={{ background: "#1e293b", borderRadius: 14, border: "1px solid #334155", overflow: "hidden" }}>
                <div style={{ padding: "16px 20px", borderBottom: "1px solid #334155" }}>
                  <h3 style={{ margin: "0 0 14px 0", fontSize: 15, fontWeight: 700, color: "#f8fafc" }}>All Tickets</h3>
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, marginBottom: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <label style={{ fontSize: 12, color: "#94a3b8", fontWeight: 600 }}>Status</label>
                      <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 6, padding: "6px 10px", color: "#e2e8f0", fontSize: 13, cursor: "pointer", minWidth: 140 }}>
                        <option value="">All</option>
                        {uniqueStatuses.map(st => <option key={st} value={st}>{st}</option>)}
                      </select>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <label style={{ fontSize: 12, color: "#94a3b8", fontWeight: 600 }}>Assignee</label>
                      <select value={filterAssignee} onChange={e => setFilterAssignee(e.target.value)} style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 6, padding: "6px 10px", color: "#e2e8f0", fontSize: 13, cursor: "pointer", minWidth: 140 }}>
                        <option value="">All</option>
                        {uniqueAssignees.map(a => <option key={a} value={a}>{a}</option>)}
                      </select>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <label style={{ fontSize: 12, color: "#94a3b8", fontWeight: 600 }}>Category</label>
                      <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)} style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 6, padding: "6px 10px", color: "#e2e8f0", fontSize: 13, cursor: "pointer", minWidth: 120 }}>
                        <option value="">All</option>
                        {uniqueCategories.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <label style={{ fontSize: 12, color: "#94a3b8", fontWeight: 600 }}>Label</label>
                      <select value={filterLabel} onChange={e => setFilterLabel(e.target.value)} style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 6, padding: "6px 10px", color: "#e2e8f0", fontSize: 13, cursor: "pointer", minWidth: 120 }}>
                        <option value="">All</option>
                        {uniqueLabels.map(l => <option key={l} value={l}>{l}</option>)}
                      </select>
                    </div>
                    <span style={{ fontSize: 12, color: "#64748b", marginLeft: "auto" }}>{filteredTickets.length} tickets</span>
                  </div>
                </div>
                <div style={{ overflowX: "auto", maxHeight: 600, overflowY: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead style={{ position: "sticky", top: 0 }}>
                      <tr style={{ background: "#0f172a" }}>
                        {["Key", "Summary", "Status", "Assignee", "Category", "Label", "1st Response", "Marked Done", "FR SLA"].map(h => (
                          <th key={h} style={{ padding: "10px 14px", textAlign: "left", color: "#64748b", fontWeight: 600, fontSize: 11, textTransform: "uppercase" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredTickets.map((t, i) => (
                        <tr key={i} style={{ borderBottom: "1px solid #1e293b", background: i % 2 === 0 ? "#1e293b" : "#1a2536" }}>
                          <td style={{ padding: "10px 14px" }}><JiraLink issueKey={t.key} /></td>
                          <td style={{ padding: "10px 14px", color: "#e2e8f0", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.summary}</td>
                          <td style={{ padding: "10px 14px" }}>
                            <span style={{ padding: "3px 8px", borderRadius: 6, fontSize: 11, fontWeight: 600,
                              background: (statusColor[t.status] || "#64748b") + "22", color: statusColor[t.status] || "#94a3b8",
                              border: `1px solid ${statusColor[t.status] || "#64748b"}44` }}>{t.status}</span>
                          </td>
                          <td style={{ padding: "10px 14px", color: "#94a3b8", fontSize: 12 }}>{t.assignee}</td>
                          <td style={{ padding: "10px 14px", color: "#64748b", fontSize: 12 }}>{t.category}</td>
                          <td style={{ padding: "10px 14px", color: "#64748b", fontSize: 12 }}>{t.labels[0] || "—"}</td>
                          <td style={{ padding: "10px 14px" }}><FRBadge mins={t.frMins} /></td>
                          <td style={{ padding: "10px 14px", color: t.doneAt ? "#94a3b8" : "#64748b", fontSize: 12 }}>
                            {t.doneAt ? new Date(t.doneAt).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}
                          </td>
                          <td style={{ padding: "10px 14px" }}><SLABadge mins={t.frMins} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              );
            })()}

            {/* Insights */}
            <div style={{ marginTop: 20, background: s.passRate >= 70 ? "linear-gradient(135deg, #14532d, #052e16)" : "linear-gradient(135deg, #7f1d1d, #450a0a)", borderRadius: 14, padding: 20, border: `1px solid ${s.passRate >= 70 ? "#166534" : "#991b1b"}` }}>
              <h3 style={{ margin: "0 0 12px 0", fontSize: 14, fontWeight: 700, color: s.passRate >= 70 ? "#86efac" : "#fca5a5" }}>Key Metrics Summary</h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, fontSize: 13, color: s.passRate >= 70 ? "#bbf7d0" : "#fecaca", lineHeight: 1.6 }}>
                <div style={{ background: "rgba(0,0,0,0.2)", borderRadius: 10, padding: 14 }}>
                  <strong style={{ color: "#fff" }}>FR SLA: {s.passRate}% pass rate</strong><br />
                  {s.within30} of {s.totalFR} responded within 30m. {s.noResp} tickets have no response.
                </div>
                <div style={{ background: "rgba(0,0,0,0.2)", borderRadius: 10, padding: 14 }}>
                  <strong style={{ color: "#fff" }}>Avg Resolution time: {s.avgRes ? (s.avgRes < 24 ? `${s.avgRes.toFixed(1)}h` : `${(s.avgRes / 24).toFixed(1)}d`) : "—"}</strong><br />
                  From created to marked Done. {s.resolved} of {s.total} tickets resolved.
                </div>
                <div style={{ background: "rgba(0,0,0,0.2)", borderRadius: 10, padding: 14 }}>
                  <strong style={{ color: "#fff" }}>{s.open} tickets still open</strong><br />
                  {Math.round(s.open / s.total * 100)}% open rate. Change date range above to explore trends.
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
