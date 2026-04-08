// Internal module. NOT exported from `packages/shared/package.json` on purpose:
// the loader is consumed only by `run-agent.ts` in the same package. Pipelines
// must go through `pctx.runAgentFn`, not `loadAgent` directly. Keeping this
// module physically unexported makes cross-package import a hard Node module
// resolution error, so the rule is enforced without a grep script.

import * as fs from "node:fs";
import * as path from "node:path";

/** A parsed agent definition: name, allowed tool list, and system prompt body. */
interface Agent {
  name: string;
  tools: string[];
  systemPrompt: string;
}

/**
 * Load an agent definition from `<agentsDir>/<name>.md`.
 *
 * Parses the YAML-ish frontmatter (`---` fenced block, `key: value` lines)
 * and returns the remaining body as `systemPrompt`. The `tools:` value is a
 * comma-separated list, parsed whitespace-tolerant and order-preserving.
 *
 * Throws if the file is missing, the frontmatter is malformed, or the
 * `tools:` field is absent.
 */
export async function loadAgent(agentsDir: string, name: string): Promise<Agent> {
  const filePath = path.join(agentsDir, `${name}.md`);

  let raw: string;
  try {
    raw = await fs.promises.readFile(filePath, "utf-8");
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Agent file missing: ${filePath} (${reason})`);
  }

  // Normalise line endings so Windows-authored files still parse.
  const normalised = raw.replace(/\r\n/g, "\n");

  if (!normalised.startsWith("---\n")) {
    throw new Error(`Agent ${name}: frontmatter must start with '---' on line 1`);
  }

  const closingIdx = normalised.indexOf("\n---", 4);
  if (closingIdx === -1) {
    throw new Error(`Agent ${name}: frontmatter block is missing a closing '---'`);
  }

  const frontmatter = normalised.slice(4, closingIdx);
  const afterClosing = closingIdx + "\n---".length;
  // Consume the newline that follows the closing fence, if any.
  const bodyStart = normalised[afterClosing] === "\n" ? afterClosing + 1 : afterClosing;
  const systemPrompt = normalised.slice(bodyStart);

  const fields: Record<string, string> = {};
  for (const line of frontmatter.split("\n")) {
    if (line.trim() === "") continue;
    const sepIdx = line.indexOf(":");
    if (sepIdx === -1) continue;
    const key = line.slice(0, sepIdx).trim();
    const value = line.slice(sepIdx + 1).trim();
    if (key) fields[key] = value;
  }

  const toolsField = fields.tools;
  if (toolsField == null) {
    throw new Error(`Agent ${name}: frontmatter is missing required 'tools:' field`);
  }

  const tools = toolsField
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  if (tools.length === 0) {
    throw new Error(`Agent ${name}: 'tools:' field is empty`);
  }

  return { name, tools, systemPrompt };
}
