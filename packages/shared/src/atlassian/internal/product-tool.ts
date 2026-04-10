import { getAtlassianMcpConfig, resolveAtlassianMcpTool, withAtlassianMcpSession } from "../mcp.js";
import type { AtlassianClientDeps } from "./deps.js";
import { availableToolsLabel } from "./deps.js";
import { resolveResourceForProduct } from "./resource-selection.js";
import { callToolWithVariants } from "./tool-call.js";

interface InvokeProductToolOptions {
  capability: Parameters<typeof resolveAtlassianMcpTool>[1];
  preferredSiteUrl?: string;
  product: "jira" | "confluence";
  scopePatterns: RegExp[];
  unavailableMessage: string;
  buildArgVariants: (resourceId?: string) => Array<Record<string, unknown>>;
}

export async function invokeProductToolViaOauth(
  options: InvokeProductToolOptions,
  deps?: AtlassianClientDeps,
): Promise<unknown | string> {
  const config = getAtlassianMcpConfig();
  if (typeof config === "string") return config;

  const withSessionFn = deps?.withMcpSessionFn ?? withAtlassianMcpSession;
  return withSessionFn(async (session) => {
    const tool = resolveAtlassianMcpTool(session, options.capability);
    if (!tool) {
      return `${options.unavailableMessage} Available tools: ${availableToolsLabel(session.toolNames)}`;
    }

    const resource = await resolveResourceForProduct(
      session,
      options.preferredSiteUrl,
      { product: options.product, scopePatterns: options.scopePatterns },
      deps,
    );
    if (typeof resource === "string") return resource;

    return callToolWithVariants(session, tool, options.buildArgVariants(resource?.id), deps);
  });
}
