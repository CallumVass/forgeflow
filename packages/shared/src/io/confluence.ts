import { type ConfluencePage, fetchConfluencePageViaOauth } from "../atlassian/index.js";
import type { ExecFn } from "./exec.js";

export type { ConfluencePage };

/**
 * Fetch a Confluence page by URL via Atlassian MCP.
 *
 * The second parameter remains for call-site compatibility with existing
 * pipeline code, but is ignored because Confluence access is now MCP-backed.
 */
export async function fetchConfluencePage(pageUrl: string, _execSafeFn: ExecFn): Promise<ConfluencePage | string> {
  return fetchConfluencePageViaOauth(pageUrl);
}
