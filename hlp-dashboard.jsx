import { useState, useEffect, useCallback, useRef } from "react";
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

const JIRA_BASE = "https://sunstonedev.atlassian.net/browse/";
const CLOUD_ID = "da340d2a-a707-4481-be7b-7bf60d05f7a3";
const SLA_FR_MIN = 30;

// Business hours config: Monday–Friday, 10:30–18:30 local time
const BUSINESS_START_HOUR = 10;
const BUSINESS_START_MINUTE = 30;
const BUSINESS_END_HOUR = 18;
const BUSINESS_END_MINUTE = 30;

// Returns the number of minutes between start and end that fall within business
// hours (Mon–Fri, 10:30–19:00). If end <= start, returns 0.
function businessMinutesBetween(start, end) {
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (!(startDate instanceof Date) || !(endDate instanceof Date) || isNaN(startDate) || isNaN(endDate)) return 0;
  if (endDate <= startDate) return 0;

  let totalMs = 0;

  // Work with a cursor that walks day by day
  let current = new Date(startDate);

  while (current < endDate) {
    const dayOfWeek = current.getDay(); // 0=Sun, 6=Sat
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      const dayStart = new Date(current);
      dayStart.setHours(BUSINESS_START_HOUR, BUSINESS_START_MINUTE, 0, 0);

      const dayEnd = new Date(current);
      dayEnd.setHours(BUSINESS_END_HOUR, BUSINESS_END_MINUTE, 0, 0);

      const windowStart = new Date(Math.max(dayStart.getTime(), startDate.getTime()));
      const windowEnd = new Date(Math.min(dayEnd.getTime(), endDate.getTime()));

      if (windowEnd > windowStart) {
        totalMs += windowEnd.getTime() - windowStart.getTime();
      }
    }

    // Move to next day at 00:00
    current.setDate(current.getDate() + 1);
    current.setHours(0, 0, 0, 0);
  }

  return Math.max(0, Math.round(totalMs / 60000));
}

// Convert an ISO timestamp from Jira into a local-date key "YYYY-MM-DD"
// so that daily bucketing matches the user's local timezone (same as Jira UI).
function toLocalDateKey(isoString) {
  if (!isoString) return null;
  const d = new Date(isoString);
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return null;
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Shift an ISO date string (YYYY-MM-DD) forward by 1 day.
// Used so that the UI "TO" date is inclusive for the whole day
// while the API still uses an exclusive upper bound.
function addOneDayISO(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  d.setDate(d.getDate() + 1);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

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

const REPORTER_PALETTE = ["#6366f1", "#22c55e", "#f97316", "#06b6d4", "#ec4899", "#eab308", "#0ea5e9", "#a855f7"];

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
  if (mins < 1 && mins > 0) display = "1m";
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

// Duration from created to marked Done (same units as 1st Response: m, h, d)
function ResolutionBadge({ resHrs, doneAt }) {
  if (resHrs === null) return <span style={{ color: "#64748b", fontWeight: 600, fontSize: 12 }}>—</span>;
  const mins = resHrs * 60;
  let display;
  if (mins < 1 && mins > 0) display = "1m";
  else if (mins < 60) display = `${Math.round(mins)}m`;
  else if (mins < 1440) display = `${(mins / 60).toFixed(1)}h`;
  else display = `${(mins / 1440).toFixed(1)}d`;
  const dateLabel = doneAt ? new Date(doneAt).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
  return (
    <span title={dateLabel ? `Done at ${dateLabel}` : ""} style={{ color: "#22c55e", fontWeight: 700, fontSize: 12 }}>
      {display}
    </span>
  );
}

// Format duration for tooltips (same style as FRBadge / ResolutionBadge)
function formatMinsForTooltip(mins) {
  if (mins == null) return "—";
  if (mins < 1 && mins > 0) return "1m";
  if (mins < 60) return `${Math.round(mins)}m`;
  if (mins < 1440) return `${(mins / 60).toFixed(1)}h`;
  return `${(mins / 1440).toFixed(1)}d`;
}
function formatHoursForTooltip(hrs) {
  if (hrs == null) return "—";
  if (hrs < 1) return `${Math.round(hrs * 60)}m`;
  if (hrs < 24) return `${Number(hrs).toFixed(1)}h`;
  return `${(hrs / 24).toFixed(1)}d`;
}

const CustomTooltip = ({ active, payload, label, filterZeros, valueFormat }) => {
  if (active && payload && payload.length) {
    const list = filterZeros ? payload.filter(p => p.value != null && p.value !== 0) : payload;
    if (list.length === 0) return null;

    // Special case: show category breakdown for no‑response view
    if (valueFormat === "noRespCategories") {
      const row = list[0]?.payload || {};
      const cats = row.noRespCategories || {};
      const entries = Object.entries(cats);
      if (!entries.length) return null;
      return (
        <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: "8px 14px", color: "#f1f5f9", fontSize: 13 }}>
          <div style={{ fontWeight: 600 }}>{row.fullName || label}</div>
          {entries.map(([cat, count], i) => (
            <div key={i} style={{ color: "#94a3b8" }}>
              {cat}: {count}
            </div>
          ))}
        </div>
      );
    }

    const format = (val) =>
      valueFormat === "minutes" ? formatMinsForTooltip(val) :
      valueFormat === "hours" ? formatHoursForTooltip(val) :
      val;
    return (
      <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: "8px 14px", color: "#f1f5f9", fontSize: 13 }}>
        <div style={{ fontWeight: 600 }}>{label}</div>
        {list.map((p, i) => (
          <div key={i} style={{ color: p.color || "#94a3b8" }}>
            {p.name}: {format(p.value)}
          </div>
        ))}
      </div>
    );
  }
  return null;
};

// ——— Jira via dev-server proxy (avoids CORS; credentials stay server-side) ———
async function fetchJiraViaProxy(startDate, endDate) {
  // _ts + cache: 'no-store' prevent 304 (no body) so we always get fresh JSON
  const apiEndDate = addOneDayISO(endDate);
  const url = `/api/jira-search?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(apiEndDate)}&_ts=${Date.now()}`;
  const response = await fetch(url, { cache: "no-store" });
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
      frMins = businessMinutesBetween(created, firstResp);
    }

    const doneAt = issue.status === "Done" ? (issue.statuscategorychangedate || issue.updated) : null;
    let resHrs = null;
    if (issue.status === "Done" && issue.created && doneAt) {
      const created = new Date(issue.created);
      const resolved = new Date(doneAt);
      const resMins = businessMinutesBetween(created, resolved);
      resHrs = Math.round((resMins / 60) * 10) / 10;
    }

    return {
      key: issue.key,
      summary: issue.summary,
      status: issue.status,
      assignee: issue.assignee || "Unassigned",
      reporter: issue.reporter || "Unknown",
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

  // Reporter breakdown
  const reporterMap = {};
  tickets.forEach(t => {
    const r = t.reporter || "Unknown";
    reporterMap[r] = (reporterMap[r] || 0) + 1;
  });
  const reporterData = Object.entries(reporterMap).sort((a, b) => b[1] - a[1]).map(([name, value], idx) => ({
    name,
    value,
    color: REPORTER_PALETTE[idx % REPORTER_PALETTE.length]
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
    { name: "0–30m", value: bucket30, color: "#22c55e" },
    { name: "30–60m", value: bucket60, color: "#f59e0b" },
    { name: "60–90m", value: bucket90, color: "#f97316" },
    { name: "90–120m", value: bucket120, color: "#ef4444" },
    { name: "120m", value: bucket120plus, color: "#dc2626" },
    { name: "No Response", value: noResp, color: "#64748b" },
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
    const d = toLocalDateKey(t.created);
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

  // Resolution time buckets (hours): 0–4 hr, 4–12 hr, 12–24 hr, 24–48 hr, 48–72 hr, 72 hr, Unresolved
  const openCount = tickets.length - resolved;
  const resBuckets = [
    { name: "0–4 hr", value: resTimes.filter(h => h <= 4).length, color: "#22c55e" },
    { name: "4–12 hr", value: resTimes.filter(h => h > 4 && h <= 12).length, color: "#4ade80" },
    { name: "12–24 hr", value: resTimes.filter(h => h > 12 && h <= 24).length, color: "#a3e635" },
    { name: "24–48 hr", value: resTimes.filter(h => h > 24 && h <= 48).length, color: "#facc15" },
    { name: "48–72 hr", value: resTimes.filter(h => h > 48 && h <= 72).length, color: "#f59e0b" },
    { name: "72 hr", value: resTimes.filter(h => h > 72).length, color: "#f97316" },
    { name: "Unresolved", value: openCount, color: "#64748b" },
  ].filter(b => b.value > 0);

  // Resolution by assignee for bar chart (avg hours)
  const assigneeRes = assigneeData.filter(a => a.avgRes !== null).map(a => ({ name: a.name, avg: Math.round(a.avgRes * 10) / 10 }));

  // Summary stats
  const totalFR = frTimes.length;
  const within30 = bucket30;
  const medianFR = frTimes.length > 0 ? frTimes.sort((a, b) => a - b)[Math.floor(frTimes.length / 2)] : 0;

  return {
    tickets, statusData, labelData, categoryData, reporterData, frBuckets, assigneeData, dailyData, assigneeFR, resBuckets, assigneeRes,
    stats: {
      total: tickets.length, resolved, open: tickets.length - resolved,
      medianFR, within30, totalFR, noResp, avgRes,
      passRate: totalFR > 0 ? Math.round(within30 / totalFR * 100) : 0,
    }
  };
}

function getISODate(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export default function HLPDashboard() {
  const [tab, setTab] = useState("Overview");
  const [startDate, setStartDate] = useState(() => {
    const today = new Date();
    const past = new Date(today);
    past.setDate(today.getDate() - 7);
    return getISODate(past);
  });
  const [endDate, setEndDate] = useState(() => getISODate(new Date()));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [filterStatus, setFilterStatus] = useState("");
  const [filterAssignee, setFilterAssignee] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterLabel, setFilterLabel] = useState("");
  const [filterReporter, setFilterReporter] = useState("");
  const [filterNoResponse, setFilterNoResponse] = useState(""); // "" | "noResponse" | "hasResponse"
  const [filterFrBucket, setFilterFrBucket] = useState(""); // from FR Distribution click; no UI on All Tickets
  const [filterResBucket, setFilterResBucket] = useState(""); // from Resolution Distribution click
  // Click-only filters: applied to All Tickets list when navigating from a chart click; dropdowns stay unchanged
  const [filterStatusClick, setFilterStatusClick] = useState("");
  const [filterAssigneeClick, setFilterAssigneeClick] = useState("");
  const [filterCategoryClick, setFilterCategoryClick] = useState("");
  const [filterLabelClick, setFilterLabelClick] = useState("");
  const [filterReporterClick, setFilterReporterClick] = useState("");
  const [filterNoResponseClick, setFilterNoResponseClick] = useState("");
  const [frGroupMode, setFrGroupMode] = useState("category");
  const [resGroupMode, setResGroupMode] = useState("category");

  const filtersRef = useRef({});
  filtersRef.current = { status: filterStatus, assignee: filterAssignee, category: filterCategory, label: filterLabel, reporter: filterReporter, noResponse: filterNoResponse, frBucket: filterFrBucket, resBucket: filterResBucket, statusClick: filterStatusClick, assigneeClick: filterAssigneeClick, categoryClick: filterCategoryClick, labelClick: filterLabelClick, reporterClick: filterReporterClick, noResponseClick: filterNoResponseClick };

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const raw = await fetchJiraViaProxy(startDate, endDate);
      const processed = processData(raw);
      setData(processed);
      setLastRefresh(new Date().toLocaleTimeString("en-IN"));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate]);

  useEffect(() => { loadData(); }, []);

  const clearAllFilters = () => {
    setFilterStatus("");
    setFilterAssignee("");
    setFilterCategory("");
    setFilterLabel("");
    setFilterReporter("");
    setFilterNoResponse("");
    setFilterStatusClick("");
    setFilterAssigneeClick("");
    setFilterCategoryClick("");
    setFilterLabelClick("");
    setFilterReporterClick("");
    setFilterNoResponseClick("");
    setFilterFrBucket("");
    setFilterResBucket("");
  };

  const switchTab = (newTab) => {
    clearAllFilters();
    setTab(newTab);
  };

  const d = data;
  const s = d?.stats;

  const allTickets = d?.tickets || [];
  const uniqueStatuses = [...new Set(allTickets.map(t => t.status).filter(Boolean))].sort();
  const uniqueAssignees = [...new Set(allTickets.map(t => t.assignee).filter(Boolean))].sort();
  const uniqueCategories = [...new Set(allTickets.map(t => t.category).filter(Boolean))].sort();
  const hasUnlabeled = allTickets.some(t => !(t.labels && t.labels.length > 0));
  const uniqueLabels = [...new Set([...(hasUnlabeled ? ["Unlabeled"] : []), ...allTickets.flatMap(t => t.labels || []).filter(Boolean)])].sort();
  const uniqueReporters = [...new Set(allTickets.map(t => t.reporter || "Unknown").filter(Boolean))].sort();

  const OPEN_STATUS_VALUE = "__open__"; // synthetic filter: show all non-Done

  const ticketMatchesFrBucket = (t, bucketName) => {
    if (!bucketName) return true;
    if (bucketName === "No Response") return t.frMins == null;
    if (t.frMins == null) return false;
    const m = t.frMins;
    if (bucketName === "0–30m") return m <= 30;
    if (bucketName === "30–60m") return m > 30 && m <= 60;
    if (bucketName === "60–90m") return m > 60 && m <= 90;
    if (bucketName === "90–120m") return m > 90 && m <= 120;
    if (bucketName === "120m") return m > 120;
    return false;
  };
  const ticketMatchesResBucket = (t, bucketName) => {
    if (!bucketName) return true;
    if (bucketName === "Unresolved") return t.status !== "Done";
    if (t.resHrs == null) return false;
    const h = t.resHrs;
    if (bucketName === "0–4 hr") return h <= 4;
    if (bucketName === "4–12 hr") return h > 4 && h <= 12;
    if (bucketName === "12–24 hr") return h > 12 && h <= 24;
    if (bucketName === "24–48 hr") return h > 24 && h <= 48;
    if (bucketName === "48–72 hr") return h > 48 && h <= 72;
    if (bucketName === "72 hr") return h > 72;
    return false;
  };

  // All Tickets list: dropdown takes precedence when set; otherwise use click filter (from chart); click filters have no UI
  const effectiveStatus = filterStatus || filterStatusClick;
  const effectiveAssignee = filterAssignee || filterAssigneeClick;
  const effectiveCategory = filterCategory || filterCategoryClick;
  const effectiveLabel = filterLabel || filterLabelClick;
  const effectiveReporter = filterReporter || filterReporterClick;
  const effectiveNoResponse = filterNoResponse || filterNoResponseClick;

  const filteredTickets = allTickets.filter(t => {
    if (effectiveStatus) {
      if (effectiveStatus === OPEN_STATUS_VALUE) { if (t.status === "Done") return false; }
      else if (t.status !== effectiveStatus) return false;
    }
    if (effectiveAssignee && t.assignee !== effectiveAssignee) return false;
    if (effectiveCategory && t.category !== effectiveCategory) return false;
    if (effectiveLabel) {
      const labels = t.labels || [];
      if (effectiveLabel === "Unlabeled") { if (labels.length > 0) return false; }
      else if (!labels.includes(effectiveLabel)) return false;
    }
    if (effectiveReporter && (t.reporter || "Unknown") !== effectiveReporter) return false;
    if (effectiveNoResponse === "noResponse" && t.frMins != null) return false;
    if (effectiveNoResponse === "hasResponse" && t.frMins == null) return false;
    if (!ticketMatchesFrBucket(t, filterFrBucket)) return false;
    if (!ticketMatchesResBucket(t, filterResBucket)) return false;
    return true;
  });

  // Same filters as All Tickets: Status, Assignee, Category, Label, Reporter (used by Overview, FR Analysis, Resolution Analysis)
  const ticketsForOverview = allTickets.filter(t => {
    if (filterStatus) {
      if (filterStatus === OPEN_STATUS_VALUE) { if (t.status === "Done") return false; }
      else if (t.status !== filterStatus) return false;
    }
    if (filterAssignee && t.assignee !== filterAssignee) return false;
    if (filterCategory && t.category !== filterCategory) return false;
    if (filterLabel) {
      const labels = t.labels || [];
      if (filterLabel === "Unlabeled") { if (labels.length > 0) return false; }
      else if (!labels.includes(filterLabel)) return false;
    }
    if (filterReporter && (t.reporter || "Unknown") !== filterReporter) return false;
    if (filterNoResponse === "noResponse" && t.frMins != null) return false;
    if (filterNoResponse === "hasResponse" && t.frMins == null) return false;
    return true;
  });

  const categoryOverviewData = (() => {
    const map = {};
    ticketsForOverview.forEach(t => {
      const c = t.category || "Unknown";
      map[c] = (map[c] || 0) + 1;
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).map(([name, value]) => ({
      name,
      value,
      color: categoryColor[name] || "#8b5cf6",
    }));
  })();

  const labelOverviewData = (() => {
    const map = {};
    ticketsForOverview.forEach(t => {
      const l = (t.labels && t.labels[0]) ? t.labels[0] : "Unlabeled";
      map[l] = (map[l] || 0) + 1;
    });
    const labelColors = { "BUG": "#ef4444", "Not_A_BUG": "#06b6d4", "Request": "#6366f1", "Unidentifed": "#f97316", "Unlabeled": "#94a3b8" };
    return Object.entries(map).sort((a, b) => b[1] - a[1]).map(([name, value]) => ({
      name,
      value,
      color: labelColors[name] || "#8b5cf6",
    }));
  })();

  const reporterOverviewData = (() => {
    const map = {};
    ticketsForOverview.forEach(t => {
      const r = t.reporter || "Unknown";
      map[r] = (map[r] || 0) + 1;
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).map(([name, value], idx) => ({
      name,
      value,
      color: REPORTER_PALETTE[idx % REPORTER_PALETTE.length],
    }));
  })();

  const dailyOverviewData = (() => {
    const map = {};
    ticketsForOverview.forEach(t => {
      const dStr = toLocalDateKey(t.created);
      if (!dStr) return;
      map[dStr] = (map[dStr] || 0) + 1;
    });
    return Object.entries(map)
      .sort()
      .map(([date, tickets]) => ({
        date: new Date(date + "T00:00:00").toLocaleDateString("en-IN", { month: "short", day: "numeric" }),
        tickets,
      }));
  })();

  const assigneeOverviewData = (() => {
    const map = {};
    ticketsForOverview.forEach(t => {
      const a = t.assignee || "Unassigned";
      if (!map[a]) map[a] = { done: 0, open: 0 };
      if (t.status === "Done") map[a].done++;
      else map[a].open++;
    });
    return Object.entries(map)
      .sort((a, b) => (b[1].done + b[1].open) - (a[1].done + a[1].open))
      .map(([name, v]) => ({
        name: name.length > 15 ? name.substring(0, 13) + ".." : name,
        fullName: name,
        done: v.done,
        open: v.open,
      }));
  })();

  // FR data from filtered tickets (for FR Analysis tab)
  const frTimesFiltered = ticketsForOverview.filter(t => t.frMins !== null).map(t => t.frMins);
  const noRespFiltered = ticketsForOverview.filter(t => t.frMins === null).length;
  const bucket30F = frTimesFiltered.filter(m => m <= 30).length;
  const bucket60F = frTimesFiltered.filter(m => m > 30 && m <= 60).length;
  const bucket90F = frTimesFiltered.filter(m => m > 60 && m <= 90).length;
  const bucket120F = frTimesFiltered.filter(m => m > 90 && m <= 120).length;
  const bucket120plusF = frTimesFiltered.filter(m => m > 120).length;
  const frBucketsFiltered = [
    { name: "0–30m", value: bucket30F, color: "#22c55e" },
    { name: "30–60m", value: bucket60F, color: "#f59e0b" },
    { name: "60–90m", value: bucket90F, color: "#f97316" },
    { name: "90–120m", value: bucket120F, color: "#ef4444" },
    { name: "120m", value: bucket120plusF, color: "#dc2626" },
    { name: "No Response", value: noRespFiltered, color: "#64748b" },
  ].filter(b => b.value > 0);
  const frStatsFiltered = {
    within30: bucket30F,
    totalFR: frTimesFiltered.length,
    noResp: noRespFiltered,
    total: ticketsForOverview.length,
    // Pass rate = within30 / total tickets (no-response counts as failing SLA)
    passRate: ticketsForOverview.length > 0 ? Math.round(bucket30F / ticketsForOverview.length * 100) : 0,
  };

  // Stats for filtered view (Overview KPIs + Key Metrics Summary when Category/Label filters apply)
  const overviewStats = (() => {
    const total = ticketsForOverview.length;
    const resolved = ticketsForOverview.filter(t => t.status === "Done").length;
    const open = total - resolved;
    const resTimes = ticketsForOverview.filter(t => t.resHrs != null).map(t => t.resHrs);
    const avgRes = resTimes.length > 0 ? resTimes.reduce((a, b) => a + b, 0) / resTimes.length : 0;
    return {
      total,
      resolved,
      open,
      within30: frStatsFiltered.within30,
      totalFR: frStatsFiltered.totalFR,
      noResp: frStatsFiltered.noResp,
      passRate: frStatsFiltered.passRate,
      avgRes,
    };
  })();

  // Resolution data from filtered tickets (for Resolution Analysis tab)
  const resTimesFiltered = ticketsForOverview.filter(t => t.resHrs != null).map(t => t.resHrs);
  const resolvedFiltered = ticketsForOverview.filter(t => t.status === "Done").length;
  const unresolvedFiltered = ticketsForOverview.length - resolvedFiltered;
  const resBucketsFiltered = [
    { name: "0–4 hr", value: resTimesFiltered.filter(h => h <= 4).length, color: "#22c55e" },
    { name: "4–12 hr", value: resTimesFiltered.filter(h => h > 4 && h <= 12).length, color: "#4ade80" },
    { name: "12–24 hr", value: resTimesFiltered.filter(h => h > 12 && h <= 24).length, color: "#a3e635" },
    { name: "24–48 hr", value: resTimesFiltered.filter(h => h > 24 && h <= 48).length, color: "#facc15" },
    { name: "48–72 hr", value: resTimesFiltered.filter(h => h > 48 && h <= 72).length, color: "#f59e0b" },
    { name: "72 hr", value: resTimesFiltered.filter(h => h > 72).length, color: "#f97316" },
    { name: "Unresolved", value: unresolvedFiltered, color: "#64748b" },
  ].filter(b => b.value > 0);
  // Grouped bar: FR by assignee × category or label
  const labelColorsMap = { BUG: "#ef4444", Not_A_BUG: "#06b6d4", Request: "#6366f1", Unidentifed: "#f97316", Unlabeled: "#94a3b8" };
  function buildFrGroupedData(mode) {
    if (mode === "noResponse") {
      const noRespByAssignee = {};
      ticketsForOverview.forEach(t => {
        if (t.frMins != null) return;
        const assignee = t.assignee || "Unassigned";
        const cat = t.category || "Unknown";
        if (!noRespByAssignee[assignee]) {
          noRespByAssignee[assignee] = { total: 0, categories: {} };
        }
        noRespByAssignee[assignee].total += 1;
        noRespByAssignee[assignee].categories[cat] = (noRespByAssignee[assignee].categories[cat] || 0) + 1;
      });
      return Object.entries(noRespByAssignee)
        .map(([fullName, info]) => ({
          name: fullName.length > 15 ? fullName.substring(0, 13) + ".." : fullName,
          fullName,
          "No response": info.total,
          noRespCategories: info.categories,
        }))
        .sort((a, b) => b["No response"] - a["No response"]);
    }
    const map = {};
    const dimValues = new Set();
    ticketsForOverview.forEach(t => {
      if (t.frMins == null) return;
      const assignee = t.assignee || "Unassigned";
      const dim = mode === "category" ? (t.category || "Unknown") : ((t.labels && t.labels[0]) || "Unlabeled");
      dimValues.add(dim);
      const key = `${assignee}||${dim}`;
      if (!map[key]) map[key] = { sum: 0, count: 0 };
      map[key].sum += t.frMins;
      map[key].count += 1;
    });
    const assignees = [...new Set(ticketsForOverview.map(t => t.assignee || "Unassigned"))];
    const dims = [...dimValues];
    return assignees.map(name => {
      const row = { name };
      dims.forEach(dim => {
        const key = `${name}||${dim}`;
        const entry = map[key];
        row[dim] = entry && entry.count ? Math.round(entry.sum / entry.count) : 0;
      });
      return row;
    });
  }
  function buildResGroupedData(mode) {
    const map = {};
    const dimValues = new Set();
    ticketsForOverview.forEach(t => {
      if (t.resHrs == null) return;
      const assignee = t.assignee || "Unassigned";
      const dim = mode === "category" ? (t.category || "Unknown") : ((t.labels && t.labels[0]) || "Unlabeled");
      dimValues.add(dim);
      const key = `${assignee}||${dim}`;
      if (!map[key]) map[key] = { sum: 0, count: 0 };
      map[key].sum += t.resHrs;
      map[key].count += 1;
    });
    const assignees = [...new Set(ticketsForOverview.map(t => t.assignee || "Unassigned"))];
    const dims = [...dimValues];
    return assignees.map(name => {
      const row = { name };
      dims.forEach(dim => {
        const key = `${name}||${dim}`;
        const entry = map[key];
        row[dim] = entry && entry.count ? +(entry.sum / entry.count).toFixed(1) : 0;
      });
      return row;
    });
  }
  const frGroupedData = buildFrGroupedData(frGroupMode);
  const frGroupedDims = frGroupMode === "noResponse"
    ? ["No response"]
    : frGroupMode === "category"
      ? [...new Set(ticketsForOverview.map(t => t.category || "Unknown"))]
      : [...new Set(ticketsForOverview.map(t => (t.labels && t.labels[0]) || "Unlabeled"))];
  const resGroupedData = buildResGroupedData(resGroupMode);
  const resGroupedDims = resGroupMode === "category"
    ? [...new Set(ticketsForOverview.map(t => t.category || "Unknown"))]
    : [...new Set(ticketsForOverview.map(t => (t.labels && t.labels[0]) || "Unlabeled"))];

  const goToAllTickets = (filters = {}) => {
    const current = filtersRef.current;
    const clearAll = Object.keys(filters).length === 0;

    // Visible dropdowns: only clear when goToAllTickets() with no args; never set from chart click
    if (clearAll) {
      setFilterStatus("");
      setFilterAssignee("");
      setFilterCategory("");
      setFilterLabel("");
      setFilterReporter("");
      setFilterNoResponse("");
    }

    // Click-only filters: set from filters when provided; clear when goToAllTickets() with no args
    setFilterStatusClick(filters.status !== undefined ? filters.status : (clearAll ? "" : current.statusClick));
    setFilterAssigneeClick(filters.assignee !== undefined ? filters.assignee : (clearAll ? "" : current.assigneeClick));
    setFilterCategoryClick(filters.category !== undefined ? filters.category : (clearAll ? "" : current.categoryClick));
    setFilterLabelClick(filters.label !== undefined ? filters.label : (clearAll ? "" : current.labelClick));
    setFilterReporterClick(filters.reporter !== undefined ? filters.reporter : (clearAll ? "" : current.reporterClick));
    setFilterNoResponseClick(filters.noResponse !== undefined ? filters.noResponse : (clearAll ? "" : current.noResponseClick));
    setFilterFrBucket(filters.frBucket !== undefined ? filters.frBucket : (clearAll ? "" : current.frBucket));
    setFilterResBucket(filters.resBucket !== undefined ? filters.resBucket : (clearAll ? "" : current.resBucket));
    setTab("All Tickets");
  };

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(145deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)", color: "#e2e8f0", fontFamily: "'Segoe UI', system-ui, sans-serif", padding: "24px 20px" }}>
      <div style={{ maxWidth: 1350, margin: "0 auto" }}>
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

        {/* Error */}
        {error && (
          <div style={{ background: "#7f1d1d", borderRadius: 10, padding: "12px 16px", marginBottom: 16, border: "1px solid #991b1b", fontSize: 13, color: "#fca5a5" }}>
            Error fetching data: {error}. Try clicking Refresh again.
          </div>
        )}

        {/* Loading */}
        {loading && !d && (
          <div style={{ textAlign: "center", padding: "60px 0", color: "#94a3b8" }}>
            <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Fetching from Jira API...</div>
            <div style={{ fontSize: 13 }}>Using Jira REST API</div>
          </div>
        )}

        {d && (
          <>
            {/* Tabs + Date Range */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 20, background: "#1e293b", borderRadius: 10, padding: "6px 10px", border: "1px solid #334155", flexWrap: "wrap" }}>
              <div style={{ display: "flex", gap: 4 }}>
                {["Overview", "FR Analysis", "Resolution Analysis", "All Tickets"].map(t => (
                  <button
                    key={t}
                    onClick={() => switchTab(t)}
                    style={{
                      padding: "8px 18px",
                      borderRadius: 8,
                      border: "none",
                      cursor: "pointer",
                      fontSize: 13,
                      fontWeight: 600,
                      background: tab === t ? "#6366f1" : "transparent",
                      color: tab === t ? "#fff" : "#94a3b8",
                      transition: "all 0.2s",
                    }}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <label style={{ fontSize: 12, color: "#94a3b8", fontWeight: 600 }}>FROM</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={e => setStartDate(e.target.value)}
                  style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 6, padding: "4px 8px", color: "#e2e8f0", fontSize: 12 }}
                />
                <label style={{ fontSize: 12, color: "#94a3b8", fontWeight: 600 }}>TO</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={e => setEndDate(e.target.value)}
                  style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 6, padding: "4px 8px", color: "#e2e8f0", fontSize: 12 }}
                />
                <button
                  onClick={loadData}
                  disabled={loading}
                  style={{
                    background: loading ? "#334155" : "#6366f1",
                    color: "#fff",
                    border: "none",
                    borderRadius: 8,
                    padding: "6px 14px",
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: loading ? "not-allowed" : "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    transition: "all 0.2s",
                  }}
                >
                  {loading ? "Fetching..." : "Refresh Data"}
                </button>
              </div>
            </div>

            {/* Status, Assignee, Category, Label, Reporter (same as All Tickets — shared across Overview, FR Analysis, Resolution Analysis) */}
            {tab !== "All Tickets" && (
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, marginBottom: 16 }}>
                <span style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>Filter by:</span>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <label style={{ fontSize: 12, color: "#94a3b8", fontWeight: 600 }}>Status</label>
                  <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 6, padding: "4px 8px", color: "#e2e8f0", fontSize: 12, cursor: "pointer", minWidth: 130 }}>
                    <option value="">All</option>
                    <option value={OPEN_STATUS_VALUE}>Open (all)</option>
                    {uniqueStatuses.map(st => <option key={st} value={st}>{st}</option>)}
                  </select>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <label style={{ fontSize: 12, color: "#94a3b8", fontWeight: 600 }}>Assignee</label>
                  <select value={filterAssignee} onChange={e => setFilterAssignee(e.target.value)} style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 6, padding: "4px 8px", color: "#e2e8f0", fontSize: 12, cursor: "pointer", minWidth: 130 }}>
                    <option value="">All</option>
                    {uniqueAssignees.map(a => <option key={a} value={a}>{a}</option>)}
                  </select>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <label style={{ fontSize: 12, color: "#94a3b8", fontWeight: 600 }}>Category</label>
                  <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)} style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 6, padding: "4px 8px", color: "#e2e8f0", fontSize: 12, cursor: "pointer", minWidth: 130 }}>
                    <option value="">All</option>
                    {uniqueCategories.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <label style={{ fontSize: 12, color: "#94a3b8", fontWeight: 600 }}>Label</label>
                  <select value={filterLabel} onChange={e => setFilterLabel(e.target.value)} style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 6, padding: "4px 8px", color: "#e2e8f0", fontSize: 12, cursor: "pointer", minWidth: 120 }}>
                    <option value="">All</option>
                    {uniqueLabels.map(l => <option key={l} value={l}>{l}</option>)}
                  </select>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <label style={{ fontSize: 12, color: "#94a3b8", fontWeight: 600 }}>Reporter</label>
                  <select value={filterReporter} onChange={e => setFilterReporter(e.target.value)} style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 6, padding: "4px 8px", color: "#e2e8f0", fontSize: 12, cursor: "pointer", minWidth: 130 }}>
                    <option value="">All</option>
                    {uniqueReporters.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <label style={{ fontSize: 12, color: "#94a3b8", fontWeight: 600 }}>First response</label>
                  <select value={filterNoResponse} onChange={e => setFilterNoResponse(e.target.value)} style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 6, padding: "4px 8px", color: "#e2e8f0", fontSize: 12, cursor: "pointer", minWidth: 120 }}>
                    <option value="">All</option>
                    <option value="noResponse">No response</option>
                    <option value="hasResponse">Has response</option>
                  </select>
                </div>
                <span style={{ fontSize: 12, color: "#64748b", marginLeft: "auto" }}>
                  {ticketsForOverview.length} of {allTickets.length} tickets
                </span>
              </div>
            )}

            {/* ===== OVERVIEW ===== */}
            {tab === "Overview" && (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(145px, 1fr))", gap: 12, marginBottom: 16 }}>
                  {[
                    { label: "Total Tickets", value: overviewStats.total, sub: "", accent: "#6366f1", onClick: () => goToAllTickets() },
                    { label: "Resolved", value: overviewStats.resolved, sub: `${overviewStats.total > 0 ? Math.round(overviewStats.resolved / overviewStats.total * 100) : 0}%`, accent: "#22c55e", onClick: () => goToAllTickets({ status: "Done" }) },
                    { label: "Open", value: overviewStats.open, sub: `${overviewStats.total > 0 ? Math.round(overviewStats.open / overviewStats.total * 100) : 0}%`, accent: "#ef4444", onClick: () => goToAllTickets({ status: OPEN_STATUS_VALUE }) },
                    { label: "FR SLA Pass", value: `${overviewStats.passRate}%`, sub: `${overviewStats.within30}/${overviewStats.total} 0–30m`, accent: overviewStats.passRate >= 70 ? "#22c55e" : "#ef4444", onClick: () => goToAllTickets() },
                    { label: "Avg Resolution time", value: overviewStats.avgRes ? (overviewStats.avgRes < 24 ? `${overviewStats.avgRes.toFixed(1)}h` : `${(overviewStats.avgRes / 24).toFixed(1)}d`) : "—", sub: `created → marked Done`, accent: "#22c55e", onClick: () => goToAllTickets() },
                  ].map((kpi, i) => (
                    <div key={i} role="button" tabIndex={0} onClick={kpi.onClick} onKeyDown={e => e.key === "Enter" && kpi.onClick()} style={{ background: "#1e293b", borderRadius: 12, padding: "16px 18px", border: "1px solid #334155", position: "relative", overflow: "hidden", cursor: "pointer" }} title="View in All Tickets">
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
                        <PieChart style={{ cursor: "pointer" }}><Pie data={categoryOverviewData} cx="50%" cy="50%" innerRadius={45} outerRadius={75} paddingAngle={3} dataKey="value" stroke="none" onClick={(entry) => goToAllTickets({ category: entry.name })}>
                          {categoryOverviewData.map((e, i) => <Cell key={i} fill={e.color} />)}
                        </Pie></PieChart>
                      </ResponsiveContainer>
                      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                        {categoryOverviewData.map((s, i) => (
                          <div key={i} role="button" tabIndex={0} onClick={() => goToAllTickets({ category: s.name })} onKeyDown={e => e.key === "Enter" && goToAllTickets({ category: s.name })} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, cursor: "pointer" }} title="View in All Tickets">
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
                        <PieChart style={{ cursor: "pointer" }}><Pie data={labelOverviewData} cx="50%" cy="50%" innerRadius={45} outerRadius={75} paddingAngle={3} dataKey="value" stroke="none" onClick={(entry) => goToAllTickets({ label: entry.name })}>
                          {labelOverviewData.map((e, i) => <Cell key={i} fill={e.color} />)}
                        </Pie></PieChart>
                      </ResponsiveContainer>
                      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                        {labelOverviewData.map((s, i) => (
                          <div key={i} role="button" tabIndex={0} onClick={() => goToAllTickets({ label: s.name })} onKeyDown={e => e.key === "Enter" && goToAllTickets({ label: s.name })} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, cursor: "pointer" }} title="View in All Tickets">
                            <div style={{ width: 10, height: 10, borderRadius: 3, background: s.color, flexShrink: 0 }} />
                            <span style={{ color: "#94a3b8" }}>{s.name}</span>
                            <span style={{ color: "#e2e8f0", fontWeight: 700, marginLeft: "auto" }}>{s.value}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                <div style={{ background: "#1e293b", borderRadius: 14, padding: 20, border: "1px solid #334155", marginBottom: 16 }}>
                  <h3 style={{ margin: "0 0 14px 0", fontSize: 14, fontWeight: 700, color: "#cbd5e1" }}>Reporters (who raised issues)</h3>
                  {reporterOverviewData.length === 0 ? (
                    <span style={{ color: "#64748b", fontSize: 12 }}>No reporters found for this range.</span>
                  ) : (
                    <div style={{ display: "flex", alignItems: "center" }}>
                      <ResponsiveContainer width="55%" height={200}>
                        <PieChart style={{ cursor: "pointer" }}>
                          <Pie
                            data={reporterOverviewData}
                            cx="50%"
                            cy="50%"
                            innerRadius={50}
                            outerRadius={85}
                            paddingAngle={3}
                            dataKey="value"
                            stroke="none"
                            onClick={(entry) => goToAllTickets({ reporter: entry.name })}
                          >
                            {reporterOverviewData.map((e, i) => (
                              <Cell key={i} fill={e.color} />
                            ))}
                          </Pie>
                        </PieChart>
                      </ResponsiveContainer>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {reporterOverviewData.map((r, i) => (
                          <div key={i} role="button" tabIndex={0} onClick={() => goToAllTickets({ reporter: r.name })} onKeyDown={e => e.key === "Enter" && goToAllTickets({ reporter: r.name })} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, cursor: "pointer" }} title="View in All Tickets">
                            <div style={{ width: 10, height: 10, borderRadius: 3, background: r.color, flexShrink: 0 }} />
                            <span style={{ color: "#94a3b8" }}>{r.name}</span>
                            <span style={{ color: "#e2e8f0", fontWeight: 700, marginLeft: "auto" }}>{r.value}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
                  <div style={{ background: "#1e293b", borderRadius: 14, padding: 20, border: "1px solid #334155" }}>
                    <h3 style={{ margin: "0 0 14px 0", fontSize: 14, fontWeight: 700, color: "#cbd5e1" }}>Daily Ticket Volume</h3>
                    <ResponsiveContainer width="100%" height={180}>
                      <BarChart data={dailyOverviewData} barSize={28} style={{ cursor: "pointer" }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                        <XAxis dataKey="date" tick={{ fill: "#94a3b8", fontSize: 10 }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
                        <Tooltip content={<CustomTooltip />} />
                        <Bar dataKey="tickets" fill="#6366f1" radius={[6, 6, 0, 0]} onClick={() => goToAllTickets()} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <div style={{ background: "#1e293b", borderRadius: 14, padding: 20, border: "1px solid #334155" }}>
                    <h3 style={{ margin: "0 0 14px 0", fontSize: 14, fontWeight: 700, color: "#cbd5e1" }}>Assignee Workload</h3>
                    <ResponsiveContainer width="100%" height={180}>
                      <BarChart data={assigneeOverviewData} layout="vertical" barSize={14} style={{ cursor: "pointer" }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
                        <XAxis type="number" tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
                        <YAxis type="category" dataKey="name" tick={{ fill: "#94a3b8", fontSize: 10 }} axisLine={false} tickLine={false} width={100} />
                        <Tooltip content={<CustomTooltip />} />
                        <Bar dataKey="done" stackId="a" fill="#22c55e" name="Done" onClick={(data) => goToAllTickets({ assignee: data.fullName || data.name })} />
                        <Bar dataKey="open" stackId="a" fill="#ef4444" radius={[0, 6, 6, 0]} name="Open" onClick={(data) => goToAllTickets({ assignee: data.fullName || data.name })} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </>
            )}

            {/* ===== FR ANALYSIS ===== */}
            {tab === "FR Analysis" && (
              <>
                {/* Grouped bar: Assignee × Category or Label */}
                <div style={{ background: "#1e293b", borderRadius: 14, padding: 20, border: "1px solid #334155", marginBottom: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
                    <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#cbd5e1" }}>Avg First Response by Assignee (grouped)</h3>
                    <div style={{ display: "flex", gap: 6, background: "#0f172a", borderRadius: 8, padding: 2, border: "1px solid #334155" }}>
                      {["category", "label", "noResponse"].map(m => (
                        <button
                          key={m}
                          onClick={() => setFrGroupMode(m)}
                          style={{
                            border: "none",
                            borderRadius: 6,
                            padding: "6px 12px",
                            fontSize: 12,
                            fontWeight: 600,
                            cursor: "pointer",
                            background: frGroupMode === m ? "#6366f1" : "transparent",
                            color: frGroupMode === m ? "#fff" : "#94a3b8",
                          }}
                        >
                          {m === "category" ? "By Category" : m === "label" ? "By Label" : "No response"}
                        </button>
                      ))}
                    </div>
                  </div>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={frGroupedData} barSize={18} margin={{ top: 8, right: 8, left: 8, bottom: 8 }} style={{ cursor: "pointer" }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                      <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
                      <Tooltip content={<CustomTooltip filterZeros valueFormat={frGroupMode === "noResponse" ? "noRespCategories" : "minutes"} />} />
                      {frGroupedDims.map((dim, idx) => (
                        <Bar
                          key={dim}
                          dataKey={dim}
                          name={dim}
                          stackId={null}
                          fill={frGroupMode === "noResponse" ? "#64748b" : (categoryColor[dim] || labelColorsMap[dim] || REPORTER_PALETTE[idx % REPORTER_PALETTE.length])}
                          radius={[4, 4, 0, 0]}
                          onClick={(data) => frGroupMode === "noResponse" ? goToAllTickets({ assignee: data.fullName || data.name, noResponse: "noResponse" }) : goToAllTickets({ assignee: data.fullName || data.name })}
                        />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
                  {/* FR Bucket Pie */}
                  <div style={{ background: "#1e293b", borderRadius: 14, padding: 20, border: "1px solid #334155" }}>
                    <h3 style={{ margin: "0 0 14px 0", fontSize: 14, fontWeight: 700, color: "#cbd5e1" }}>First Response Distribution</h3>
                    <div style={{ display: "flex", alignItems: "center" }}>
                      <ResponsiveContainer width="55%" height={220}>
                        <PieChart style={{ cursor: "pointer" }}><Pie data={frBucketsFiltered} cx="50%" cy="50%" innerRadius={50} outerRadius={85} paddingAngle={3} dataKey="value" stroke="none" onClick={(data) => goToAllTickets(data?.name != null ? { frBucket: data.name, resBucket: "" } : {})}>
                          {frBucketsFiltered.map((e, i) => <Cell key={i} fill={e.color} />)}
                        </Pie></PieChart>
                      </ResponsiveContainer>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {frBucketsFiltered.map((b, i) => (
                          <div key={i} role="button" tabIndex={0} onClick={() => goToAllTickets({ frBucket: b.name, resBucket: "" })} onKeyDown={e => e.key === "Enter" && goToAllTickets({ frBucket: b.name, resBucket: "" })} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }} title={`View tickets: ${b.name}`}>
                            <div style={{ width: 12, height: 12, borderRadius: 3, background: b.color, flexShrink: 0 }} />
                            <span style={{ color: "#94a3b8" }}>{b.name}</span>
                            <span style={{ color: "#e2e8f0", fontWeight: 700, marginLeft: "auto" }}>{b.value}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Category-wise Distribution (FR Analysis) */}
                  <div style={{ background: "#1e293b", borderRadius: 14, padding: 20, border: "1px solid #334155" }}>
                    <h3 style={{ margin: "0 0 14px 0", fontSize: 14, fontWeight: 700, color: "#cbd5e1" }}>Category-wise Distribution</h3>
                    <div style={{ display: "flex", alignItems: "center" }}>
                      <ResponsiveContainer width="55%" height={220}>
                        <PieChart style={{ cursor: "pointer" }}><Pie data={categoryOverviewData} cx="50%" cy="50%" innerRadius={50} outerRadius={85} paddingAngle={3} dataKey="value" stroke="none" onClick={(entry) => goToAllTickets({ category: entry.name })}>
                          {categoryOverviewData.map((e, i) => <Cell key={i} fill={e.color} />)}
                        </Pie></PieChart>
                      </ResponsiveContainer>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {categoryOverviewData.map((s, i) => (
                          <div key={i} role="button" tabIndex={0} onClick={() => goToAllTickets({ category: s.name })} onKeyDown={e => e.key === "Enter" && goToAllTickets({ category: s.name })} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, cursor: "pointer" }} title="View in All Tickets">
                            <div style={{ width: 10, height: 10, borderRadius: 3, background: s.color, flexShrink: 0 }} />
                            <span style={{ color: "#94a3b8" }}>{s.name}</span>
                            <span style={{ color: "#e2e8f0", fontWeight: 700, marginLeft: "auto" }}>{s.value}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* ===== RESOLUTION ANALYSIS ===== */}
            {tab === "Resolution Analysis" && (
              <>
                {/* Grouped bar: Assignee × Category or Label */}
                <div style={{ background: "#1e293b", borderRadius: 14, padding: 20, border: "1px solid #334155", marginBottom: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
                    <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#cbd5e1" }}>Avg Resolution by Assignee (grouped)</h3>
                    <div style={{ display: "flex", gap: 6, background: "#0f172a", borderRadius: 8, padding: 2, border: "1px solid #334155" }}>
                      {["category", "label"].map(m => (
                        <button
                          key={m}
                          onClick={() => setResGroupMode(m)}
                          style={{
                            border: "none",
                            borderRadius: 6,
                            padding: "6px 12px",
                            fontSize: 12,
                            fontWeight: 600,
                            cursor: "pointer",
                            background: resGroupMode === m ? "#6366f1" : "transparent",
                            color: resGroupMode === m ? "#fff" : "#94a3b8",
                          }}
                        >
                          {m === "category" ? "By Category" : "By Label"}
                        </button>
                      ))}
                    </div>
                  </div>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={resGroupedData} barSize={18} margin={{ top: 8, right: 8, left: 8, bottom: 8 }} style={{ cursor: "pointer" }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                      <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
                      <Tooltip content={<CustomTooltip filterZeros valueFormat="hours" />} />
                      {resGroupedDims.map((dim, idx) => (
                        <Bar
                          key={dim}
                          dataKey={dim}
                          name={dim}
                          stackId={null}
                          fill={categoryColor[dim] || labelColorsMap[dim] || REPORTER_PALETTE[idx % REPORTER_PALETTE.length]}
                          radius={[4, 4, 0, 0]}
                          onClick={(data) => goToAllTickets({ assignee: data.name })}
                        />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
                  <div style={{ background: "#1e293b", borderRadius: 14, padding: 20, border: "1px solid #334155" }}>
                    <h3 style={{ margin: "0 0 14px 0", fontSize: 14, fontWeight: 700, color: "#cbd5e1" }}>Resolution Time Distribution</h3>
                    <div style={{ display: "flex", alignItems: "center" }}>
                      <ResponsiveContainer width="55%" height={220}>
                        <PieChart style={{ cursor: "pointer" }}><Pie data={resBucketsFiltered} cx="50%" cy="50%" innerRadius={50} outerRadius={85} paddingAngle={3} dataKey="value" stroke="none" onClick={(data) => goToAllTickets(data?.name != null ? { resBucket: data.name, frBucket: "" } : {})}>
                          {resBucketsFiltered.map((e, i) => <Cell key={i} fill={e.color} />)}
                        </Pie></PieChart>
                      </ResponsiveContainer>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {resBucketsFiltered.map((b, i) => (
                          <div key={i} role="button" tabIndex={0} onClick={() => goToAllTickets({ resBucket: b.name, frBucket: "" })} onKeyDown={e => e.key === "Enter" && goToAllTickets({ resBucket: b.name, frBucket: "" })} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }} title={`View tickets: ${b.name}`}>
                            <div style={{ width: 12, height: 12, borderRadius: 3, background: b.color, flexShrink: 0 }} />
                            <span style={{ color: "#94a3b8" }}>{b.name}</span>
                            <span style={{ color: "#e2e8f0", fontWeight: 700, marginLeft: "auto" }}>{b.value}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div style={{ background: "#1e293b", borderRadius: 14, padding: 20, border: "1px solid #334155" }}>
                    <h3 style={{ margin: "0 0 14px 0", fontSize: 14, fontWeight: 700, color: "#cbd5e1" }}>Category-wise Distribution</h3>
                    <div style={{ display: "flex", alignItems: "center" }}>
                      <ResponsiveContainer width="55%" height={220}>
                        <PieChart style={{ cursor: "pointer" }}><Pie data={categoryOverviewData} cx="50%" cy="50%" innerRadius={50} outerRadius={85} paddingAngle={3} dataKey="value" stroke="none" onClick={(entry) => goToAllTickets({ category: entry.name })}>
                          {categoryOverviewData.map((e, i) => <Cell key={i} fill={e.color} />)}
                        </Pie></PieChart>
                      </ResponsiveContainer>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {categoryOverviewData.map((s, i) => (
                          <div key={i} role="button" tabIndex={0} onClick={() => goToAllTickets({ category: s.name })} onKeyDown={e => e.key === "Enter" && goToAllTickets({ category: s.name })} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, cursor: "pointer" }} title="View in All Tickets">
                            <div style={{ width: 10, height: 10, borderRadius: 3, background: s.color, flexShrink: 0 }} />
                            <span style={{ color: "#94a3b8" }}>{s.name}</span>
                            <span style={{ color: "#e2e8f0", fontWeight: 700, marginLeft: "auto" }}>{s.value}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* ===== ALL TICKETS ===== */}
            {tab === "All Tickets" && (() => {
              return (
              <div style={{ background: "#1e293b", borderRadius: 14, border: "1px solid #334155", overflow: "hidden" }}>
                <div style={{ padding: "16px 20px", borderBottom: "1px solid #334155" }}>
                  <h3 style={{ margin: "0 0 14px 0", fontSize: 15, fontWeight: 700, color: "#f8fafc" }}>All Tickets</h3>
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, marginBottom: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <label style={{ fontSize: 12, color: "#94a3b8", fontWeight: 600 }}>Status</label>
                      <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 6, padding: "6px 10px", color: "#e2e8f0", fontSize: 13, cursor: "pointer", minWidth: 140 }}>
                        <option value="">All</option>
                        <option value={OPEN_STATUS_VALUE}>Open (all)</option>
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
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <label style={{ fontSize: 12, color: "#94a3b8", fontWeight: 600 }}>Reporter</label>
                      <select value={filterReporter} onChange={e => setFilterReporter(e.target.value)} style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 6, padding: "6px 10px", color: "#e2e8f0", fontSize: 13, cursor: "pointer", minWidth: 140 }}>
                        <option value="">All</option>
                        {uniqueReporters.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <label style={{ fontSize: 12, color: "#94a3b8", fontWeight: 600 }}>First response</label>
                      <select value={filterNoResponse} onChange={e => setFilterNoResponse(e.target.value)} style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 6, padding: "6px 10px", color: "#e2e8f0", fontSize: 13, cursor: "pointer", minWidth: 120 }}>
                        <option value="">All</option>
                        <option value="noResponse">No response</option>
                        <option value="hasResponse">Has response</option>
                      </select>
                    </div>
                    <span style={{ fontSize: 12, color: "#64748b", marginLeft: "auto" }}>{filteredTickets.length} tickets</span>
                  </div>
                </div>
                <div style={{ overflowX: "auto", maxHeight: 600, overflowY: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead style={{ position: "sticky", top: 0 }}>
                      <tr style={{ background: "#0f172a" }}>
                        {["Key", "Summary", "Status", "Reporter", "Assignee", "Category", "Label", "1st Response", "Marked Done", "FR SLA"].map(h => (
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
                          <td style={{ padding: "10px 14px", color: "#94a3b8", fontSize: 12 }}>{t.reporter || "—"}</td>
                          <td style={{ padding: "10px 14px", color: "#94a3b8", fontSize: 12 }}>{t.assignee}</td>
                          <td style={{ padding: "10px 14px", color: "#64748b", fontSize: 12 }}>{t.category}</td>
                          <td style={{ padding: "10px 14px", color: "#64748b", fontSize: 12 }}>{t.labels[0] || "—"}</td>
                          <td style={{ padding: "10px 14px" }}><FRBadge mins={t.frMins} /></td>
                          <td style={{ padding: "10px 14px" }}><ResolutionBadge resHrs={t.resHrs} doneAt={t.doneAt} /></td>
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
            <div style={{ marginTop: 20, background: overviewStats.passRate >= 70 ? "linear-gradient(135deg, #14532d, #052e16)" : "linear-gradient(135deg, #7f1d1d, #450a0a)", borderRadius: 14, padding: 20, border: `1px solid ${overviewStats.passRate >= 70 ? "#166534" : "#991b1b"}` }}>
              <h3 style={{ margin: "0 0 12px 0", fontSize: 14, fontWeight: 700, color: overviewStats.passRate >= 70 ? "#86efac" : "#fca5a5" }}>Key Metrics Summary</h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, fontSize: 13, color: overviewStats.passRate >= 70 ? "#bbf7d0" : "#fecaca", lineHeight: 1.6 }}>
                <div style={{ background: "rgba(0,0,0,0.2)", borderRadius: 10, padding: 14 }}>
                  <strong style={{ color: "#fff" }}>FR SLA: {overviewStats.passRate}% pass rate</strong><br />
                  {overviewStats.within30} of {overviewStats.total} responded within 0–30m. {overviewStats.noResp} tickets have no response.
                </div>
                <div style={{ background: "rgba(0,0,0,0.2)", borderRadius: 10, padding: 14 }}>
                  <strong style={{ color: "#fff" }}>Avg Resolution time: {overviewStats.avgRes ? (overviewStats.avgRes < 24 ? `${overviewStats.avgRes.toFixed(1)}h` : `${(overviewStats.avgRes / 24).toFixed(1)}d`) : "—"}</strong><br />
                  From created to marked Done. {overviewStats.resolved} of {overviewStats.total} tickets resolved.
                </div>
                <div style={{ background: "rgba(0,0,0,0.2)", borderRadius: 10, padding: 14 }}>
                  <strong style={{ color: "#fff" }}>{overviewStats.open} tickets still open</strong><br />
                  {overviewStats.total > 0 ? Math.round(overviewStats.open / overviewStats.total * 100) : 0}% open rate. Change date range above to explore trends.
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
