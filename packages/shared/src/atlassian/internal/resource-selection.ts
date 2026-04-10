import { type callAtlassianMcpTool, resolveAtlassianMcpTool } from "../mcp.js";
import type { AtlassianClientDeps } from "./deps.js";
import { isRecord, normaliseOrigin } from "./deps.js";
import { callToolWithVariants } from "./tool-call.js";

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

export async function resolveResourceForProduct(
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
