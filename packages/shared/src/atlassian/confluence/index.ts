import { extractPageId, parseConfluencePageResponse } from "../internal/confluence-parser.js";
import { type AtlassianClientDeps, availableToolsLabel } from "../internal/deps.js";
import { resolveResourceForProduct } from "../internal/resource-selection.js";
import { callToolWithVariants } from "../internal/tool-call.js";
import { getAtlassianMcpConfig, resolveAtlassianMcpTool, withAtlassianMcpSession } from "../mcp.js";

export type { ConfluencePage } from "./types.js";

export async function fetchConfluencePageViaOauth(
  pageUrl: string,
  deps?: AtlassianClientDeps,
): Promise<import("./types.js").ConfluencePage | string> {
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
      deps?.siteUrl ?? pageUrl,
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
