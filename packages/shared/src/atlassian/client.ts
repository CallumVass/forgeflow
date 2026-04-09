import { adfToPlainText, normalisePlainText, plainTextToAdf } from "./adf.js";
import {
  type AtlassianAccessibleResource,
  fetchAtlassianAccessibleResources,
  getAtlassianAccessToken,
  getAtlassianOauthConfig,
} from "./oauth.js";

export interface ConfluencePage {
  id: string;
  title: string;
  body: string;
}

export interface JiraIssue {
  key: string;
  title: string;
  body: string;
  issueType?: string;
}

export interface JiraIssueDraft {
  summary: string;
  description: string;
  issueType?: string;
}

export interface JiraCreatedIssue {
  id: string;
  key: string;
  url: string;
}

export type AtlassianContent =
  | ({ kind: "jira"; url: string } & JiraIssue)
  | ({ kind: "confluence"; url: string } & ConfluencePage);

interface AtlassianClientDeps {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  now?: () => number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getFetch(fetchImpl?: typeof fetch): typeof fetch {
  return fetchImpl ?? fetch;
}

function normaliseOrigin(input: string): string {
  return new URL(input).origin;
}

function extractPageId(url: string): string | null {
  const pathMatch = url.match(/\/pages\/(\d+)/);
  if (pathMatch?.[1]) return pathMatch[1];
  const paramMatch = url.match(/[?&]pageId=(\d+)/);
  return paramMatch?.[1] ?? null;
}

function extractTextField(fields: Record<string, unknown>, names: Record<string, string>, patterns: RegExp[]): string {
  for (const [fieldId, fieldName] of Object.entries(names)) {
    if (!patterns.some((pattern) => pattern.test(fieldName))) continue;
    const value = fields[fieldId];
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    const text = adfToPlainText(value);
    if (text) return text;
  }
  return "";
}

async function ensureOauthContext(
  deps?: AtlassianClientDeps,
): Promise<{ accessToken: string; resources: AtlassianAccessibleResource[] } | string> {
  const access = await getAtlassianAccessToken(deps);
  if (typeof access === "string") return access;

  const resources = await fetchAtlassianAccessibleResources(access.accessToken, deps);
  if (typeof resources === "string") return resources;

  return { accessToken: access.accessToken, resources };
}

function resolveResource(
  resources: AtlassianAccessibleResource[],
  preferredSiteUrl?: string,
): AtlassianAccessibleResource | string {
  if (preferredSiteUrl) {
    const preferredOrigin = normaliseOrigin(preferredSiteUrl);
    const match = resources.find((resource) => {
      try {
        return normaliseOrigin(resource.url) === preferredOrigin;
      } catch {
        return false;
      }
    });
    if (match) return match;
    return `No Atlassian OAuth resource matched ${preferredOrigin}.`;
  }

  const uniqueOrigins = Array.from(
    new Map(resources.map((resource) => [normaliseOrigin(resource.url), resource])).values(),
  );
  if (uniqueOrigins.length === 1) return uniqueOrigins[0] as AtlassianAccessibleResource;
  return "Multiple Atlassian sites are available. Set ATLASSIAN_URL to choose one.";
}

async function requestJson(
  url: string,
  accessToken: string,
  deps?: AtlassianClientDeps,
  init?: RequestInit,
): Promise<unknown | string> {
  const response = await getFetch(deps?.fetchImpl)(url, {
    ...init,
    signal: deps?.signal,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });

  let data: unknown;
  try {
    data = (await response.json()) as unknown;
  } catch {
    return `Could not parse Atlassian response from ${url} (HTTP ${response.status}).`;
  }

  if (!response.ok) {
    if (isRecord(data)) {
      const message = [data.message, data.errorMessages]
        .flat()
        .find((value): value is string => typeof value === "string");
      if (message) return `Atlassian request failed (HTTP ${response.status}): ${message}`;
    }
    return `Atlassian request failed (HTTP ${response.status}) for ${url}.`;
  }

  return data;
}

function htmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<h([1-6])[^>]*>/gi, (_m, level) => `${"#".repeat(parseInt(level as string, 10))} `)
    .replace(/<\/?strong>/gi, "**")
    .replace(/<\/?em>/gi, "*")
    .replace(/<\/?code>/gi, "`")
    .replace(
      /<ac:structured-macro[^>]*ac:name="code"[^>]*>[\s\S]*?<ac:plain-text-body><!\[CDATA\[([\s\S]*?)\]\]><\/ac:plain-text-body>[\s\S]*?<\/ac:structured-macro>/gi,
      "\n```\n$1\n```\n",
    )
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function parseConfluencePageResponse(data: unknown, pageId: string): ConfluencePage | string {
  if (!isRecord(data)) return `Unexpected Confluence response for page ${pageId}.`;

  const title = typeof data.title === "string" ? data.title : "Untitled";
  const bodyRecord = isRecord(data.body) ? data.body : undefined;
  const storageRecord = bodyRecord && isRecord(bodyRecord.storage) ? bodyRecord.storage : undefined;
  const html = typeof storageRecord?.value === "string" ? storageRecord.value : "";

  return {
    id: typeof data.id === "string" ? data.id : pageId,
    title,
    body: normalisePlainText(htmlToPlainText(html)),
  };
}

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

export async function fetchConfluencePageViaOauth(
  pageUrl: string,
  deps?: AtlassianClientDeps,
): Promise<ConfluencePage | string> {
  const pageId = extractPageId(pageUrl);
  if (!pageId) return `Could not extract page ID from URL: ${pageUrl}`;

  const auth = await ensureOauthContext(deps);
  if (typeof auth === "string") return auth;

  const resource = resolveResource(auth.resources, pageUrl);
  if (typeof resource === "string") return resource;

  const apiUrl = `https://api.atlassian.com/ex/confluence/${resource.id}/wiki/api/v2/pages/${pageId}?body-format=storage`;
  const data = await requestJson(apiUrl, auth.accessToken, deps);
  if (typeof data !== "string") return parseConfluencePageResponse(data, pageId);

  if (!/HTTP (401|403)/.test(data)) return data;

  const legacyApiUrl = `https://api.atlassian.com/ex/confluence/${resource.id}/wiki/rest/api/content/${pageId}?expand=body.storage`;
  const legacyData = await requestJson(legacyApiUrl, auth.accessToken, deps);
  if (typeof legacyData === "string") return legacyData;

  return parseConfluencePageResponse(legacyData, pageId);
}

export async function fetchJiraIssueViaOauth(
  jiraKey: string,
  deps?: AtlassianClientDeps & { siteUrl?: string },
): Promise<JiraIssue | string> {
  const auth = await ensureOauthContext(deps);
  if (typeof auth === "string") return auth;

  const config = getAtlassianOauthConfig();
  const siteUrl = deps?.siteUrl ?? (typeof config === "string" ? undefined : config.siteUrl);
  const resource = resolveResource(auth.resources, siteUrl);
  if (typeof resource === "string") return resource;

  const apiUrl = `https://api.atlassian.com/ex/jira/${resource.id}/rest/api/3/issue/${jiraKey}?expand=names`;
  const data = await requestJson(apiUrl, auth.accessToken, deps);
  if (typeof data === "string") return data;
  if (!isRecord(data)) return `Unexpected Jira response for issue ${jiraKey}.`;

  const fields = isRecord(data.fields) ? data.fields : {};
  const names = isRecord(data.names)
    ? Object.fromEntries(
        Object.entries(data.names).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
      )
    : {};
  const title = typeof fields.summary === "string" ? fields.summary : jiraKey;
  const description = typeof fields.description === "string" ? fields.description : adfToPlainText(fields.description);
  const acceptanceCriteria = extractTextField(fields, names, [/acceptance criteria/i]);
  const storyPoints = extractTextField(fields, names, [/story points?/i, /story point estimate/i]);
  const sprint = extractTextField(fields, names, [/sprint/i]);
  const issueType =
    isRecord(fields.issuetype) && typeof fields.issuetype.name === "string" ? fields.issuetype.name : undefined;

  const bodyParts = [description];
  if (acceptanceCriteria) bodyParts.push(`## Acceptance Criteria\n${acceptanceCriteria}`);
  if (isRecord(fields.status) && typeof fields.status.name === "string")
    bodyParts.push(`**Status:** ${fields.status.name}`);
  if (isRecord(fields.priority) && typeof fields.priority.name === "string")
    bodyParts.push(`**Priority:** ${fields.priority.name}`);
  if (storyPoints) bodyParts.push(`**Story Points:** ${storyPoints}`);
  if (sprint) bodyParts.push(`**Sprint:** ${sprint}`);

  return {
    key: jiraKey,
    title,
    body: normalisePlainText(bodyParts.filter(Boolean).join("\n\n")),
    issueType,
  };
}

export async function fetchJiraIssueFromUrl(issueUrl: string, deps?: AtlassianClientDeps): Promise<JiraIssue | string> {
  const jiraKey = extractJiraKey(issueUrl);
  if (!jiraKey) return `Could not extract Jira issue key from URL: ${issueUrl}`;
  return fetchJiraIssueViaOauth(jiraKey, { ...deps, siteUrl: issueUrl });
}

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

export async function createJiraIssueViaOauth(
  issue: JiraIssueDraft & { projectKey: string },
  deps?: AtlassianClientDeps & { siteUrl?: string },
): Promise<JiraCreatedIssue | string> {
  const auth = await ensureOauthContext(deps);
  if (typeof auth === "string") return auth;

  const config = getAtlassianOauthConfig();
  const siteUrl = deps?.siteUrl ?? (typeof config === "string" ? undefined : config.siteUrl);
  const resource = resolveResource(auth.resources, siteUrl);
  if (typeof resource === "string") return resource;

  const apiUrl = `https://api.atlassian.com/ex/jira/${resource.id}/rest/api/3/issue`;
  const payload: Record<string, unknown> = {
    fields: {
      project: { key: issue.projectKey },
      summary: issue.summary,
      issuetype: { name: issue.issueType ?? "Story" },
      ...(issue.description.trim() ? { description: plainTextToAdf(issue.description) } : {}),
    },
  };

  const data = await requestJson(apiUrl, auth.accessToken, deps, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (typeof data === "string") return data;
  if (!isRecord(data)) return `Unexpected Jira create response for ${issue.summary}.`;

  const key = typeof data.key === "string" ? data.key : "";
  const id = typeof data.id === "string" ? data.id : "";
  const baseUrl = normaliseOrigin(resource.url);
  if (!key || !id) return `Jira create response for ${issue.summary} did not include id/key.`;

  return {
    id,
    key,
    url: `${baseUrl}/browse/${key}`,
  };
}
