const JIRA_API_BASE = "https://sunstonedev.atlassian.net/rest/api/3";

// Exclude these author names from counting as "first response" (bots/automation)
const SYSTEM_AUTHOR_PATTERN =
  /^(jira|atlassian|widget|automation|freshdesk|system|\[.*\]|.*bot.*)$/i;

function getFirstResponseDate(comments, reporterDisplayName, issueCreated) {
  if (!comments || comments.length === 0) return null;
  const reporterKey = (reporterDisplayName || "").toLowerCase().trim();
  const ticketCreatedMs = issueCreated ? new Date(issueCreated).getTime() : 0;

  const sorted = [...comments].sort(
    (a, b) => new Date(a.created || 0) - new Date(b.created || 0),
  );

  const firstByAgent = sorted.find((c) => {
    const name = (c.author?.displayName || c.author?.name || "").trim();
    const nameLower = name.toLowerCase();
    if (!name) return false;
    if (SYSTEM_AUTHOR_PATTERN.test(name)) return false;

    const commentMs = new Date(c.created || 0).getTime();

    // Exclude comments at ticket creation (within 2 min) — description/auto-created.
    if (ticketCreatedMs && commentMs - ticketCreatedMs < 2 * 60 * 1000) {
      return false;
    }
    // Exclude reporter when their comment is near creation (within 30 min).
    if (
      reporterKey &&
      nameLower === reporterKey &&
      ticketCreatedMs &&
      commentMs - ticketCreatedMs < 30 * 60 * 1000
    ) {
      return false;
    }

    return true;
  });

  return firstByAgent ? firstByAgent.created : null;
}

export default async function handler(req, res) {
  try {
    const { startDate, endDate } = req.query || {};

    // Avoid Vercel/edge and browser caches so Jira results are always fresh (no 304)
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");

    const email = process.env.JIRA_EMAIL || process.env.VITE_JIRA_EMAIL;
    const token = process.env.JIRA_API_TOKEN || process.env.VITE_JIRA_API_TOKEN;

    if (!email || !token) {
      res.status(500).json({
        error:
          "JIRA_EMAIL and JIRA_API_TOKEN must be set in Vercel (Project Settings > Environment Variables). Use JIRA_* not VITE_* — VITE_* are build-time only and are not available to serverless.",
      });
      return;
    }

    if (!startDate || !endDate) {
      res.status(400).json({ error: "startDate and endDate required" });
      return;
    }

    // Interpret the date picker values as local dates (e.g. Asia/Kolkata),
    // convert them to UTC wall-clock times, then use those in JQL so that
    // "TO = 16" really means "up to the end of 16th in my timezone".
    const localDateToUtcJira = (dateStr, plusDays = 0) => {
      const d = new Date(`${dateStr}T00:00:00`);
      if (Number.isNaN(d.getTime())) return null;
      d.setDate(d.getDate() + plusDays);
      // We want the *UTC* calendar date/time string Jira expects: "YYYY-MM-DD HH:MM"
      const year = d.getUTCFullYear();
      const month = String(d.getUTCMonth() + 1).padStart(2, "0");
      const day = String(d.getUTCDate()).padStart(2, "0");
      const hours = String(d.getUTCHours()).padStart(2, "0");
      const minutes = String(d.getUTCMinutes()).padStart(2, "0");
      return `${year}-${month}-${day} ${hours}:${minutes}`;
    };

    const startUtc = localDateToUtcJira(startDate, 0);
    const endExclusiveUtc = localDateToUtcJira(endDate, 1); // next local day at 00:00 → UTC

    if (!startUtc || !endExclusiveUtc) {
      res.status(400).json({ error: "Invalid startDate or endDate" });
      return;
    }

    const jql = `project = HLP AND created >= "${startUtc}" AND created < "${endExclusiveUtc}" ORDER BY created ASC`;
    const auth = Buffer.from(`${email}:${token}`).toString("base64");
    const FIELDS = [
      "summary",
      "status",
      "assignee",
      "reporter",
      "creator",
      "labels",
      "comment",
      "created",
      "resolutiondate",
      "updated",
      "customfield_10117",
    ];
    const PAGE_SIZE = 100;

    // Paginate using /rest/api/3/search/jql (nextPageToken; legacy /search was removed)
    let allIssues = [];
    let nextPageToken = null;

    do {
      const body = {
        jql,
        maxResults: PAGE_SIZE,
        fields: FIELDS,
      };
      if (nextPageToken) body.nextPageToken = nextPageToken;

      const jiraRes = await fetch(`${JIRA_API_BASE}/search/jql`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!jiraRes.ok) {
        const errText = await jiraRes.text();
        res
          .status(jiraRes.status)
          .json({ error: `Jira API: ${errText || jiraRes.statusText}` });
        return;
      }

      const json = await jiraRes.json();
      const issues = json.issues || [];
      allIssues = allIssues.concat(issues);
      nextPageToken = json.isLast ? null : (json.nextPageToken || null);
    } while (nextPageToken);

    const total = allIssues.length;
    console.log("[jira-search]", { startDate, endDate, total, jql });

    // Optional lightweight debug: /api/jira-search?...&meta=1
    if (req.query?.meta === "1") {
      res.status(200).json({
        total,
        jql,
        envUsed: email === process.env.JIRA_EMAIL ? "JIRA_EMAIL" : "VITE_JIRA_EMAIL",
        warning:
          "meta=1 is for debugging only; remove for full issue payload.",
      });
      return;
    }

    res.setHeader("X-Jira-Total", String(total));

    const issues = allIssues.map((issue) => {
      const f = issue.fields || {};
      const created = f.created || null;
      const comments = f.comment?.comments || [];
      const reporterName =
        f.reporter?.displayName ||
        f.reporter?.name ||
        f.reporter?.emailAddress ||
        f.creator?.displayName ||
        f.creator?.name ||
        f.creator?.emailAddress ||
        null;
      const firstResponseDate = getFirstResponseDate(
        comments,
        reporterName,
        created,
      );
      const statusName = f.status?.name || "Unknown";
      const isDone = statusName.toLowerCase() === "done";
      const statuscategorychangedate = isDone
        ? f.resolutiondate || f.statuscategorychangedate || f.updated
        : null;

      return {
        key: issue.key,
        summary: f.summary || "",
        status: statusName,
        assignee: f.assignee?.displayName || "Unassigned",
        // Use human-friendly reporter/creator name when available; otherwise fall back to accountId
        reporter:
          reporterName ||
          f.reporter?.accountId ||
          f.creator?.accountId ||
          "Unknown",
        labels: f.labels || [],
        category: f.customfield_10117?.value ?? f.customfield_10117 ?? "Unknown",
        created,
        statuscategorychangedate,
        updated: f.updated || null,
        firstTeamCommentDate: firstResponseDate,
      };
    });

    res.status(200).json(issues);
  } catch (e) {
    res.status(500).json({ error: e.message || "Proxy error" });
  }
}

