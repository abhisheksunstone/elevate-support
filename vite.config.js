import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import dotenv from "dotenv";

// Load .env so proxy can read JIRA_EMAIL and JIRA_API_TOKEN
dotenv.config();

const JIRA_API_BASE = "https://sunstonedev.atlassian.net/rest/api/3";

// Exclude these author names from counting as "first response" (bots/automation)
const SYSTEM_AUTHOR_PATTERN = /^(jira|atlassian|widget|automation|freshdesk|system|\[.*\]|.*bot.*)$/i;

function jiraProxyPlugin() {
  return {
    name: "jira-proxy",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url?.startsWith("/api/jira-search?")) {
          try {
            const u = new URL(req.url, "http://localhost");
            const startDate = u.searchParams.get("startDate");
            const endDate = u.searchParams.get("endDate");
            const email = process.env.JIRA_EMAIL || process.env.VITE_JIRA_EMAIL;
            const token = process.env.JIRA_API_TOKEN || process.env.VITE_JIRA_API_TOKEN;
            if (!email || !token) {
              res.statusCode = 500;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ error: "JIRA_EMAIL and JIRA_API_TOKEN (or VITE_*) must be set in .env" }));
              return;
            }
            if (!startDate || !endDate) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: "startDate and endDate required" }));
              return;
            }
            const jql = `project = HLP AND created >= "${startDate}" AND created <= "${endDate}" ORDER BY created ASC`;
            const auth = Buffer.from(`${email}:${token}`).toString("base64");
            const PAGE_SIZE = 100;
            const FIELDS = ["summary", "status", "assignee", "reporter", "creator", "labels", "comment", "created", "resolutiondate", "updated", "customfield_10117"];
            let allRawIssues = [];
            let nextPageToken = null;
            do {
              const body = { jql, maxResults: PAGE_SIZE, fields: FIELDS };
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
                const err = await jiraRes.text();
                res.statusCode = jiraRes.status;
                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify({ error: `Jira API: ${err || jiraRes.statusText}` }));
                return;
              }
              const pageJson = await jiraRes.json();
              const issues = pageJson.issues || [];
              allRawIssues = allRawIssues.concat(issues);
              nextPageToken = pageJson.isLast ? null : (pageJson.nextPageToken || null);
            } while (nextPageToken);
            const json = { issues: allRawIssues, total: allRawIssues.length };

            // First response = chronologically first comment by anyone except bots/automation.
            // - Exclude comments at ticket creation (within 2 min) — description/auto-created.
            // - Exclude reporter only when their comment is near creation (within 2 hr) — so reporter's later reply as support still counts.
            function getFirstResponseDate(comments, reporterDisplayName, issueCreated) {
              if (!comments || comments.length === 0) return null;
              const reporterKey = (reporterDisplayName || "").toLowerCase().trim();
              const ticketCreatedMs = issueCreated ? new Date(issueCreated).getTime() : 0;
              const sorted = [...comments].sort((a, b) => new Date(a.created || 0) - new Date(b.created || 0));
              const firstByAgent = sorted.find((c) => {
                const name = (c.author?.displayName || c.author?.name || "").trim();
                const nameLower = name.toLowerCase();
                if (!name) return false;
                if (SYSTEM_AUTHOR_PATTERN.test(name)) return false;
                const commentMs = new Date(c.created || 0).getTime();
                if (ticketCreatedMs && commentMs - ticketCreatedMs < 2 * 60 * 1000) return false;
                if (reporterKey && nameLower === reporterKey && ticketCreatedMs && commentMs - ticketCreatedMs < 30 * 60 * 1000) return false;
                return true;
              });
              return firstByAgent ? firstByAgent.created : null;
            }

            // Get "marked Done" time from changelog (status → Done)
            function getDoneAtFromChangelog(changelog) {
              const histories = changelog?.histories || [];
              for (let i = histories.length - 1; i >= 0; i--) {
                const h = histories[i];
                const items = h.items || [];
                for (const it of items) {
                  if ((it.field || "").toLowerCase() !== "status") continue;
                  const toVal = (it.toString || it.to || "").toLowerCase();
                  if (toVal === "done") return h.created || null;
                }
              }
              return null;
            }

            let issues = (json.issues || []).map((issue) => {
              const f = issue.fields || {};
              const created = f.created || null;
              const comments = f.comment?.comments || [];

              // Prefer human-friendly reporter/creator identifiers
              const reporterDisplayKey =
                f.reporter?.displayName ||
                f.reporter?.name ||
                f.reporter?.emailAddress ||
                f.creator?.displayName ||
                f.creator?.name ||
                f.creator?.emailAddress ||
                null;

              // What we show in charts / UI (fall back to accountId if names are hidden)
              const reporterForGrouping =
                reporterDisplayKey ||
                f.reporter?.accountId ||
                f.creator?.accountId ||
                "Unknown";

              const firstResponseDate = getFirstResponseDate(
                comments,
                reporterDisplayKey,
                created
              );
              const doneAtFromHistory = getDoneAtFromChangelog(issue.changelog);
              const statusName = f.status?.name || "Unknown";
              const isDone = statusName.toLowerCase() === "done";
              const statuscategorychangedate =
                doneAtFromHistory ||
                (isDone ? (f.resolutiondate || f.statuscategorychangedate || f.updated) : null);
              return {
                key: issue.key,
                summary: f.summary || "",
                status: statusName,
                assignee: f.assignee?.displayName || "Unassigned",
                reporter: reporterForGrouping,
                labels: f.labels || [],
                category: f.customfield_10117?.value ?? f.customfield_10117 ?? "Unknown",
                created,
                statuscategorychangedate,
                updated: f.updated || null,
                firstTeamCommentDate: firstResponseDate,
                _needsChangelog: isDone && !statuscategorychangedate,
                _needsComments: !firstResponseDate,
                _reporter: reporterDisplayKey,
                _created: created,
              };
            });

            // For issues with no first response yet, fetch full comment list (includes internal comments)
            const needsComments = issues.filter((i) => i._needsComments);
            if (needsComments.length > 0) {
              const firstResponseByKey = {};
              await Promise.all(
                needsComments.map(async (i) => {
                  const comRes = await fetch(`${JIRA_API_BASE}/issue/${i.key}/comment?maxResults=200`, {
                    headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
                  });
                  if (!comRes.ok) return;
                  const comJson = await comRes.json();
                  const comments = comJson.comments || [];
                  const fr = getFirstResponseDate(comments, i._reporter, i._created);
                  if (fr) firstResponseByKey[i.key] = fr;
                })
              );
              issues = issues.map((i) => {
                const fr = i._needsComments ? firstResponseByKey[i.key] : null;
                const firstTeamCommentDate = fr != null ? fr : i.firstTeamCommentDate;
                const { _needsComments, _reporter, _created, ...rest } = i;
                return { ...rest, firstTeamCommentDate };
              });
            }

            // If search didn't return changelog, fetch it for Done issues missing marked-done time
            const needsChangelog = issues.filter((i) => i._needsChangelog);
            if (needsChangelog.length > 0) {
              const doneAtByKey = {};
              await Promise.all(
                needsChangelog.map(async (i) => {
                  const clRes = await fetch(`${JIRA_API_BASE}/issue/${i.key}?expand=changelog`, {
                    headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
                  });
                  if (!clRes.ok) return;
                  const clJson = await clRes.json();
                  const doneAt = getDoneAtFromChangelog(clJson.changelog);
                  if (doneAt) doneAtByKey[i.key] = doneAt;
                })
              );
              issues = issues.map((i) => {
                const doneAt = i._needsChangelog ? doneAtByKey[i.key] : null;
                const statuscategorychangedate = doneAt || i.statuscategorychangedate;
                const { _needsChangelog, ...rest } = i;
                return { ...rest, statuscategorychangedate };
              });
            } else {
              issues = issues.map(({ _needsChangelog, ...rest }) => rest);
            }
            issues = issues.map(({ _needsChangelog, _needsComments, _reporter, _created, ...rest }) => rest);
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(issues));
          } catch (e) {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: e.message || "Proxy error" }));
          }
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), jiraProxyPlugin()],
  root: ".",
});
