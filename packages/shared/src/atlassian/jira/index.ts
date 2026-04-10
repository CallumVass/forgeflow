import { plainTextToAdf } from "../adf.js";
import { type AtlassianClientDeps, availableToolsLabel, buildIssueUrl } from "../internal/deps.js";
import { parseJiraCreateResponse, parseJiraIssueResponse } from "../internal/jira-parser.js";
import { resolveResourceForProduct } from "../internal/resource-selection.js";
import { callToolWithVariants } from "../internal/tool-call.js";
import { getAtlassianMcpConfig, resolveAtlassianMcpTool, withAtlassianMcpSession } from "../mcp.js";

export type { JiraCreatedIssue, JiraIssue, JiraIssueDraft } from "./types.js";

export function extractJiraKey(input: string): string | null {
  const match = input.match(/\b[A-Z][A-Z0-9]+-\d+\b/);
  return match?.[0] ?? null;
}

export function extractProjectKey(issueKey: string): string {
  return issueKey.split("-")[0] ?? issueKey;
}

export function getJiraCreationDefaults(env: NodeJS.ProcessEnv = process.env): {
  projectKey?: string;
  issueType: string;
} {
  const projectKey = env.ATLASSIAN_JIRA_PROJECT?.trim() || undefined;
  const issueType = env.ATLASSIAN_JIRA_ISSUE_TYPE?.trim() || "Story";
  return { projectKey, issueType };
}

export async function fetchJiraIssueViaOauth(
  jiraKey: string,
  deps?: AtlassianClientDeps,
): Promise<import("./types.js").JiraIssue | string> {
  const config = getAtlassianMcpConfig();
  if (typeof config === "string") return config;

  const siteUrl = deps?.siteUrl ?? config.siteUrl;
  const issueUrl = buildIssueUrl(jiraKey, siteUrl);
  const withSessionFn = deps?.withMcpSessionFn ?? withAtlassianMcpSession;
  const result = await withSessionFn(async (session) => {
    const tool = resolveAtlassianMcpTool(session, "jiraGetIssue");
    if (!tool) {
      return `The current Atlassian MCP server does not expose a Jira issue reader forgeflow can use. Available tools: ${availableToolsLabel(session.toolNames)}`;
    }

    const resource = await resolveResourceForProduct(
      session,
      siteUrl,
      { product: "jira", scopePatterns: [/^read:jira-work$/, /^write:jira-work$/] },
      deps,
    );
    if (typeof resource === "string") return resource;

    return callToolWithVariants(
      session,
      tool,
      [
        ...(resource
          ? [
              { cloudId: resource.id, issueIdOrKey: jiraKey },
              { cloudId: resource.id, issueKey: jiraKey },
              { cloudId: resource.id, key: jiraKey },
              { cloudId: resource.id, jiraKey },
              ...(issueUrl
                ? [
                    { cloudId: resource.id, url: issueUrl },
                    { cloudId: resource.id, issueUrl },
                  ]
                : []),
            ]
          : []),
        { issueKey: jiraKey },
        { key: jiraKey },
        { jiraKey },
        ...(issueUrl ? [{ url: issueUrl }, { issueUrl }] : []),
      ],
      deps,
    );
  });
  if (typeof result === "string") return result;

  return parseJiraIssueResponse(result, jiraKey);
}

export async function fetchJiraIssueFromUrl(
  issueUrl: string,
  deps?: AtlassianClientDeps,
): Promise<import("./types.js").JiraIssue | string> {
  const jiraKey = extractJiraKey(issueUrl);
  if (!jiraKey) return `Could not extract Jira issue key from URL: ${issueUrl}`;
  return fetchJiraIssueViaOauth(jiraKey, { ...deps, siteUrl: issueUrl });
}

export async function createJiraIssueViaOauth(
  issue: import("./types.js").JiraIssueDraft & { projectKey: string },
  deps?: AtlassianClientDeps,
): Promise<import("./types.js").JiraCreatedIssue | string> {
  const config = getAtlassianMcpConfig();
  if (typeof config === "string") return config;

  const siteUrl = deps?.siteUrl ?? config.siteUrl;
  const withSessionFn = deps?.withMcpSessionFn ?? withAtlassianMcpSession;
  const result = await withSessionFn(async (session) => {
    const tool = resolveAtlassianMcpTool(session, "jiraCreateIssue");
    if (!tool) {
      return `The current Atlassian MCP server does not expose a Jira issue creation tool forgeflow can use. Available tools: ${availableToolsLabel(session.toolNames)}`;
    }

    const resource = await resolveResourceForProduct(
      session,
      siteUrl,
      { product: "jira", scopePatterns: [/^read:jira-work$/, /^write:jira-work$/] },
      deps,
    );
    if (typeof resource === "string") return resource;

    return callToolWithVariants(
      session,
      tool,
      [
        ...(resource
          ? [
              {
                cloudId: resource.id,
                projectKey: issue.projectKey,
                summary: issue.summary,
                description: issue.description,
                issueType: issue.issueType ?? "Story",
              },
              {
                cloudId: resource.id,
                issue: {
                  projectKey: issue.projectKey,
                  summary: issue.summary,
                  description: issue.description,
                  issueType: issue.issueType ?? "Story",
                },
              },
              {
                cloudId: resource.id,
                fields: {
                  project: { key: issue.projectKey },
                  summary: issue.summary,
                  issuetype: { name: issue.issueType ?? "Story" },
                  ...(issue.description.trim() ? { description: plainTextToAdf(issue.description) } : {}),
                },
              },
            ]
          : []),
        {
          projectKey: issue.projectKey,
          summary: issue.summary,
          description: issue.description,
          issueType: issue.issueType ?? "Story",
        },
        {
          issue: {
            projectKey: issue.projectKey,
            summary: issue.summary,
            description: issue.description,
            issueType: issue.issueType ?? "Story",
          },
        },
        {
          fields: {
            project: { key: issue.projectKey },
            summary: issue.summary,
            issuetype: { name: issue.issueType ?? "Story" },
            ...(issue.description.trim() ? { description: plainTextToAdf(issue.description) } : {}),
          },
        },
      ],
      deps,
    );
  });
  if (typeof result === "string") return result;

  return parseJiraCreateResponse(result, issue.summary, siteUrl);
}
