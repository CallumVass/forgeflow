import { callAtlassianMcpTool, parseAtlassianMcpJson } from "../mcp.js";
import type { AtlassianClientDeps } from "./deps.js";

function shouldRetryWithNextArgs(message: string): boolean {
  return /(missing|required|argument|parameter|schema|invalid input|invalid arguments)/i.test(message);
}

export async function callToolWithVariants(
  session: Parameters<typeof callAtlassianMcpTool>[0],
  toolName: string,
  argVariants: Array<Record<string, unknown>>,
  deps?: AtlassianClientDeps,
): Promise<unknown | string> {
  const callToolFn = deps?.callMcpToolFn ?? callAtlassianMcpTool;
  let lastError = "Atlassian MCP returned no usable result.";

  for (const args of argVariants) {
    const raw = await callToolFn(session, toolName, args);
    const parsed = parseAtlassianMcpJson(raw);
    if (typeof parsed === "string") {
      lastError = parsed;
      if (!shouldRetryWithNextArgs(parsed)) return parsed;
      continue;
    }
    return parsed;
  }

  return lastError;
}
