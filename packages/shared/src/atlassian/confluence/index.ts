import { extractPageId, parseConfluencePageResponse } from "../internal/confluence-parser.js";
import type { AtlassianClientDeps } from "../internal/deps.js";
import { invokeProductToolViaOauth } from "../internal/product-tool.js";

export type { ConfluencePage } from "./types.js";

export async function fetchConfluencePageViaOauth(
  pageUrl: string,
  deps?: AtlassianClientDeps,
): Promise<import("./types.js").ConfluencePage | string> {
  const pageId = extractPageId(pageUrl);
  if (!pageId) return `Could not extract page ID from URL: ${pageUrl}`;

  const result = await invokeProductToolViaOauth(
    {
      capability: "confluenceGetPage",
      preferredSiteUrl: deps?.siteUrl ?? pageUrl,
      product: "confluence",
      scopePatterns: [/^read:confluence-content\./, /^read:page:confluence$/, /^read:content-details:confluence$/],
      unavailableMessage:
        "The current Atlassian MCP server does not expose a Confluence page reader forgeflow can use.",
      buildArgVariants: (resourceId) => [
        ...(resourceId
          ? [
              { cloudId: resourceId, pageId },
              { cloudId: resourceId, id: pageId },
              { cloudId: resourceId, url: pageUrl },
              { cloudId: resourceId, pageUrl },
            ]
          : []),
        { url: pageUrl },
        { pageUrl },
        { pageId },
        { id: pageId },
      ],
    },
    deps,
  );
  if (typeof result === "string") return result;

  return parseConfluencePageResponse(result, pageId);
}
