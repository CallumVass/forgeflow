import { fetchConfluencePageViaOauth } from "../confluence/index.js";
import { extractPageId } from "../internal/confluence-parser.js";
import type { AtlassianClientDeps } from "../internal/deps.js";
import { extractJiraKey, fetchJiraIssueFromUrl } from "../jira/index.js";

export type AtlassianContent =
  | ({ kind: "jira"; url: string } & import("../jira/types.js").JiraIssue)
  | ({ kind: "confluence"; url: string } & import("../confluence/types.js").ConfluencePage);

export async function fetchAtlassianContentFromUrl(
  inputUrl: string,
  deps?: AtlassianClientDeps,
): Promise<AtlassianContent | string> {
  try {
    new URL(inputUrl);
  } catch {
    return `Invalid Atlassian URL: ${inputUrl}`;
  }

  if (extractPageId(inputUrl)) {
    const page = await fetchConfluencePageViaOauth(inputUrl, deps);
    if (typeof page === "string") return page;
    return { kind: "confluence", url: inputUrl, ...page };
  }

  const jiraKey = extractJiraKey(inputUrl);
  if (jiraKey) {
    const issue = await fetchJiraIssueFromUrl(inputUrl, deps);
    if (typeof issue === "string") return issue;
    return { kind: "jira", url: inputUrl, ...issue };
  }

  return `Unsupported Atlassian URL: ${inputUrl}. Pass a Jira issue URL or Confluence page URL.`;
}

export function formatAtlassianContent(content: AtlassianContent): string {
  const body =
    content.body.trim() ||
    (content.kind === "jira"
      ? "No Jira description was found on this issue."
      : "No Confluence body was found on this page.");

  if (content.kind === "jira") {
    const issueType = content.issueType ? ` (${content.issueType})` : "";
    return `# Jira ${content.key}${issueType}: ${content.title}\n\nSource: ${content.url}\n\n${body}`;
  }

  return `# Confluence: ${content.title}\n\nSource: ${content.url}\n\n${body}`;
}
