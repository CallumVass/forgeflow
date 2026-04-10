import { adfToPlainText, normalisePlainText, plainTextToAdf } from "./adf.js";
import {
  callAtlassianMcpTool,
  getAtlassianMcpConfig,
  resolveAtlassianMcpTool,
  withAtlassianMcpSession,
} from "./mcp.js";

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
  signal?: AbortSignal;
  withMcpSessionFn?: typeof withAtlassianMcpSession;
  callMcpToolFn?: typeof callAtlassianMcpTool;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normaliseOrigin(input: string): string {
  return new URL(input).origin;
}

interface AtlassianAccessibleResource {
  id: string;
  url: string;
  name?: string;
  scopes: string[];
}

function matchScopeCount(resource: AtlassianAccessibleResource, patterns: RegExp[]): number {
  return resource.scopes.filter((scope) => patterns.some((pattern) => pattern.test(scope))).length;
}

function describeResourceScopes(resources: AtlassianAccessibleResource[]): string {
  return resources
    .map((resource) => {
      const scopes = resource.scopes.length > 0 ? resource.scopes.join(", ") : "(none reported)";
      return `${resource.id}: ${scopes}`;
    })
    .join("; ");
}

function parseAccessibleResourcesResponse(data: unknown): AtlassianAccessibleResource[] | string {
  const nested = Array.isArray(data)
    ? data
    : isRecord(data) && Array.isArray(data.resources)
      ? data.resources
      : isRecord(data) && Array.isArray(data.result)
        ? data.result
        : isRecord(data) && Array.isArray(data.sites)
          ? data.sites
          : null;
  if (!nested) return "Unexpected Atlassian resource response.";

  const resources: AtlassianAccessibleResource[] = nested
    .filter(isRecord)
    .map((entry) => {
      const id =
        typeof entry.id === "string" ? entry.id : typeof entry.cloudId === "string" ? entry.cloudId : undefined;
      const url = typeof entry.url === "string" ? entry.url : undefined;
      if (!id || !url) return null;

      const resource: AtlassianAccessibleResource = {
        id,
        url,
        scopes: Array.isArray(entry.scopes)
          ? entry.scopes.filter((scope): scope is string => typeof scope === "string")
          : [],
      };
      if (typeof entry.name === "string") resource.name = entry.name;
      return resource;
    })
    .filter((entry): entry is AtlassianAccessibleResource => entry !== null);

  if (resources.length === 0) return "Atlassian MCP did not report any accessible Jira or Confluence resources.";
  return resources;
}

function resolveAccessibleResource(
  resources: AtlassianAccessibleResource[],
  preferredSiteUrl: string | undefined,
  options: { product: "jira" | "confluence"; scopePatterns: RegExp[] },
): AtlassianAccessibleResource | string {
  let candidates = resources;
  let originLabel = "the selected Atlassian site";

  if (preferredSiteUrl) {
    const preferredOrigin = normaliseOrigin(preferredSiteUrl);
    originLabel = preferredOrigin;
    candidates = resources.filter((resource) => {
      try {
        return normaliseOrigin(resource.url) === preferredOrigin;
      } catch {
        return false;
      }
    });
    if (candidates.length === 0) return `No Atlassian MCP resource matched ${preferredOrigin}.`;
  } else {
    const origins = Array.from(new Set(resources.map((resource) => normaliseOrigin(resource.url))));
    if (origins.length !== 1) return "Multiple Atlassian sites are available. Set ATLASSIAN_URL to choose one.";
    originLabel = origins[0] ?? originLabel;
  }

  const scopedCandidates = candidates
    .map((resource) => ({ resource, score: matchScopeCount(resource, options.scopePatterns) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
  if (scopedCandidates.length > 0) return scopedCandidates[0]?.resource as AtlassianAccessibleResource;
  if (candidates.length === 1) return candidates[0] as AtlassianAccessibleResource;

  return `No Atlassian MCP resource for ${originLabel} had ${options.product} scopes. Available scopes: ${describeResourceScopes(candidates)}. Set ATLASSIAN_URL if you need a different site, then re-run /atlassian-login after granting the required ${options.product} scopes.`;
}

async function resolveResourceForProduct(
  session: Parameters<typeof callAtlassianMcpTool>[0],
  preferredSiteUrl: string | undefined,
  options: { product: "jira" | "confluence"; scopePatterns: RegExp[] },
  deps?: AtlassianClientDeps,
): Promise<AtlassianAccessibleResource | string | undefined> {
  const tool = resolveAtlassianMcpTool(session, "accessibleResources");
  if (!tool) return undefined;

  const resourcesResult = await callToolWithVariants(session, tool, [{}], deps);
  if (typeof resourcesResult === "string") return resourcesResult;

  const resources = parseAccessibleResourcesResponse(resourcesResult);
  if (typeof resources === "string") return resources;
  return resolveAccessibleResource(resources, preferredSiteUrl, options);
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

  const nested = isRecord(data.page) ? data.page : isRecord(data.result) ? data.result : data;
  if (typeof nested.body === "string") {
    return {
      id: typeof nested.id === "string" ? nested.id : pageId,
      title: typeof nested.title === "string" ? nested.title : "Untitled",
      body: normalisePlainText(nested.body),
    };
  }

  const title = typeof nested.title === "string" ? nested.title : "Untitled";
  const bodyRecord = isRecord(nested.body) ? nested.body : undefined;
  const storageRecord = bodyRecord && isRecord(bodyRecord.storage) ? bodyRecord.storage : undefined;
  const html = typeof storageRecord?.value === "string" ? storageRecord.value : "";

  return {
    id: typeof nested.id === "string" ? nested.id : pageId,
    title,
    body: normalisePlainText(htmlToPlainText(html)),
  };
}

function parseJiraIssueResponse(data: unknown, jiraKey: string): JiraIssue | string {
  if (!isRecord(data)) return `Unexpected Jira response for issue ${jiraKey}.`;

  const nested = isRecord(data.issue) ? data.issue : isRecord(data.result) ? data.result : data;
  if (typeof nested.body === "string" || typeof nested.description === "string") {
    return {
      key: typeof nested.key === "string" ? nested.key : jiraKey,
      title:
        typeof nested.title === "string" ? nested.title : typeof nested.summary === "string" ? nested.summary : jiraKey,
      body: normalisePlainText(String(nested.body ?? nested.description ?? "")),
      issueType:
        typeof nested.issueType === "string"
          ? nested.issueType
          : typeof nested.type === "string"
            ? nested.type
            : undefined,
    };
  }

  const fields = isRecord(nested.fields) ? nested.fields : {};
  const names = isRecord(nested.names)
    ? Object.fromEntries(
        Object.entries(nested.names).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
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
    key: typeof nested.key === "string" ? nested.key : jiraKey,
    title,
    body: normalisePlainText(bodyParts.filter(Boolean).join("\n\n")),
    issueType,
  };
}

function parseJiraCreateResponse(data: unknown, summary: string, siteUrl?: string): JiraCreatedIssue | string {
  if (!isRecord(data)) return `Unexpected Jira create response for ${summary}.`;

  const nested = isRecord(data.issue) ? data.issue : isRecord(data.createdIssue) ? data.createdIssue : data;
  const key = typeof nested.key === "string" ? nested.key : "";
  const id = typeof nested.id === "string" ? nested.id : "";
  const url =
    typeof nested.url === "string" ? nested.url : key && siteUrl ? `${normaliseOrigin(siteUrl)}/browse/${key}` : key;
  if (!key || !id) return `Jira create response for ${summary} did not include id/key.`;

  return { id, key, url };
}

function availableToolsLabel(toolNames: string[]): string {
  return toolNames.length > 0 ? toolNames.join(", ") : "(none reported)";
}

function shouldRetryWithNextArgs(message: string): boolean {
  return /(missing|required|argument|parameter|schema|invalid input|invalid arguments)/i.test(message);
}

function buildIssueUrl(jiraKey: string, siteUrl?: string): string | undefined {
  if (!siteUrl) return undefined;
  return `${normaliseOrigin(siteUrl)}/browse/${jiraKey}`;
}

async function callToolWithVariants(
  session: Parameters<typeof callAtlassianMcpTool>[0],
  toolName: string,
  argVariants: Array<Record<string, unknown>>,
  deps?: AtlassianClientDeps,
): Promise<unknown | string> {
  const callToolFn = deps?.callMcpToolFn ?? callAtlassianMcpTool;
  let lastError = "Atlassian MCP returned no usable result.";

  for (const args of argVariants) {
    const raw = await callToolFn(session, toolName, args);
    if (typeof raw === "string") {
      lastError = raw;
      if (!shouldRetryWithNextArgs(raw)) return raw;
      continue;
    }

    if (!isRecord(raw)) return raw;
    if (raw.isError === true) {
      const content = Array.isArray(raw.content) ? raw.content : [];
      const entry = content.find((item) => isRecord(item) && item.type === "text" && typeof item.text === "string");
      const message =
        isRecord(entry) && typeof entry.text === "string" ? entry.text : "Atlassian MCP returned an error.";
      lastError = message;
      if (!shouldRetryWithNextArgs(message)) return message;
      continue;
    }

    const textEntry = Array.isArray(raw.content)
      ? raw.content.find((item) => isRecord(item) && item.type === "text" && typeof item.text === "string")
      : undefined;
    if (!isRecord(textEntry) || typeof textEntry.text !== "string") {
      return "Atlassian MCP returned no text content.";
    }

    try {
      return JSON.parse(textEntry.text) as unknown;
    } catch {
      return textEntry.text;
    }
  }

  return lastError;
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
  const config = getAtlassianMcpConfig();
  if (typeof config === "string") return config;

  const pageId = extractPageId(pageUrl);
  if (!pageId) return `Could not extract page ID from URL: ${pageUrl}`;

  const withSessionFn = deps?.withMcpSessionFn ?? withAtlassianMcpSession;
  const result = await withSessionFn(async (session) => {
    const tool = resolveAtlassianMcpTool(session, "confluenceGetPage");
    if (!tool) {
      return `The current Atlassian MCP server does not expose a Confluence page reader forgeflow can use. Available tools: ${availableToolsLabel(session.toolNames)}`;
    }

    const resource = await resolveResourceForProduct(
      session,
      pageUrl,
      {
        product: "confluence",
        scopePatterns: [/^read:confluence-content\./, /^read:page:confluence$/, /^read:content-details:confluence$/],
      },
      deps,
    );
    if (typeof resource === "string") return resource;

    return callToolWithVariants(
      session,
      tool,
      [
        ...(resource
          ? [
              { cloudId: resource.id, pageId },
              { cloudId: resource.id, id: pageId },
              { cloudId: resource.id, url: pageUrl },
              { cloudId: resource.id, pageUrl },
            ]
          : []),
        { url: pageUrl },
        { pageUrl },
        { pageId },
        { id: pageId },
      ],
      deps,
    );
  });
  if (typeof result === "string") return result;

  return parseConfluencePageResponse(result, pageId);
}

export async function fetchJiraIssueViaOauth(
  jiraKey: string,
  deps?: AtlassianClientDeps & { siteUrl?: string },
): Promise<JiraIssue | string> {
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
