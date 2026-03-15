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

    // Avoid Vercel/edge caches so Jira results are always fresh
    res.setHeader("Cache-Control", "no-store, max-age=0");

    const email = process.env.JIRA_EMAIL || process.env.VITE_JIRA_EMAIL;
    const token = process.env.JIRA_API_TOKEN || process.env.VITE_JIRA_API_TOKEN;

    if (!email || !token) {
      res
        .status(500)
        .json({
          error:
            "JIRA_EMAIL and JIRA_API_TOKEN (or VITE_*) must be set in Vercel environment variables",
        });
      return;
    }

    if (!startDate || !endDate) {
      res.status(400).json({ error: "startDate and endDate required" });
      return;
    }

    const jql = `project = HLP AND created >= "${startDate}" AND created <= "${endDate}" ORDER BY created ASC`;
    const auth = Buffer.from(`${email}:${token}`).toString("base64");

    const jiraRes = await fetch(`${JIRA_API_BASE}/search/jql`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jql,
        maxResults: 100,
        fields: [
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
        ],
      }),
    });

    if (!jiraRes.ok) {
      const errText = await jiraRes.text();
      res
        .status(jiraRes.status)
        .json({ error: `Jira API: ${errText || jiraRes.statusText}` });
      return;
    }

    const json = await jiraRes.json();

    // Optional lightweight debug: /api/jira-search?...&meta=1
    if (req.query?.meta === "1") {
      res.status(200).json({
        total: json.total ?? (json.issues || []).length ?? 0,
        warning:
          "meta=1 is for debugging only; remove this query param for full issue payload.",
      });
      return;
    }

    const issues = (json.issues || []).map((issue) => {
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

