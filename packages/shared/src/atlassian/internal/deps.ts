import type { callAtlassianMcpTool, withAtlassianMcpSession } from "../mcp.js";

export interface AtlassianClientDeps {
  signal?: AbortSignal;
  siteUrl?: string;
  withMcpSessionFn?: typeof withAtlassianMcpSession;
  callMcpToolFn?: typeof callAtlassianMcpTool;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normaliseOrigin(input: string): string {
  return new URL(input).origin;
}

export function availableToolsLabel(toolNames: string[]): string {
  return toolNames.length > 0 ? toolNames.join(", ") : "(none reported)";
}

export function buildIssueUrl(jiraKey: string, siteUrl?: string): string | undefined {
  if (!siteUrl) return undefined;
  return `${normaliseOrigin(siteUrl)}/browse/${jiraKey}`;
}
