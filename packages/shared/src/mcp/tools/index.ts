import type { McpSession, McpTool } from "../types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractTaggedBlock(text: string, tag: string): string | undefined {
  const match = text.match(new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*</${tag}>`, "i"));
  return match?.[1]?.trim();
}

function extractFirstText(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined;
  const entry = content.find((item) => isRecord(item) && item.type === "text" && typeof item.text === "string");
  if (!entry || !isRecord(entry)) return undefined;
  return typeof entry.text === "string" ? entry.text : undefined;
}

function parseStructuredMcpText(text: string): unknown | string {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // Fall through to tagged payload extraction.
  }

  const wrappedJson = extractTaggedBlock(text, "JSON_DATA");
  if (wrappedJson !== undefined) {
    try {
      return JSON.parse(wrappedJson) as unknown;
    } catch {
      return wrappedJson;
    }
  }

  const wrappedYaml = extractTaggedBlock(text, "YAML_DATA");
  if (wrappedYaml !== undefined) {
    const trimmed = wrappedYaml.trim();
    if (!trimmed) return [];
    return trimmed;
  }

  return text;
}

export async function callMcpTool(
  session: Pick<McpSession, "client">,
  name: string,
  args: Record<string, unknown>,
  serviceLabel: string,
) {
  try {
    return await session.client.callTool({ name, arguments: args });
  } catch (err) {
    return `${serviceLabel} tool ${name} failed: ${(err as Error).message}`;
  }
}

export function parseMcpJson(result: unknown, serviceLabel: string): unknown | string {
  if (typeof result === "string") return result;
  if (!isRecord(result)) return `${serviceLabel} returned an unexpected response.`;

  if (result.isError === true) {
    const message = extractFirstText(result.content);
    return message || `${serviceLabel} returned an error.`;
  }

  const text = extractFirstText(result.content);
  if (!text) return `${serviceLabel} returned no text content.`;

  return parseStructuredMcpText(text);
}

function normaliseToolText(value: string | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function scoreTool(
  tool: McpTool,
  requiredTerms: string[],
  optionalTerms: string[],
  options: { requireOptionalMatch?: boolean } = {},
): number {
  const haystack = `${normaliseToolText(tool.name)} ${normaliseToolText(tool.description)}`.trim();
  if (!haystack) return -1;
  if (requiredTerms.some((term) => !haystack.includes(term))) return -1;

  const optionalMatches = optionalTerms.filter((term) => haystack.includes(term)).length;
  if (options.requireOptionalMatch && optionalMatches === 0) return -1;

  let score = 0;
  for (const term of requiredTerms) {
    if (normaliseToolText(tool.name).includes(term)) score += 5;
    else score += 2;
  }
  for (const term of optionalTerms) {
    if (haystack.includes(term)) score += normaliseToolText(tool.name).includes(term) ? 3 : 1;
  }
  return score;
}

export function resolveMcpTool(
  session: Pick<McpSession, "tools" | "toolNames">,
  aliases: string[],
  requiredTerms: string[],
  optionalTerms: string[],
  options: { requireOptionalMatch?: boolean } = {},
): string | undefined {
  for (const alias of aliases) {
    if (session.toolNames.includes(alias)) return alias;
  }

  return session.tools
    .map((tool) => ({ tool, score: scoreTool(tool, requiredTerms, optionalTerms, options) }))
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name))[0]?.tool.name;
}
