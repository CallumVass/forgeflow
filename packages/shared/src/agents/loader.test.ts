import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadAgent } from "./loader.js";

function makeAgentsDir(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-agent-loader-"));
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content, "utf-8");
  }
  return dir;
}

describe("loadAgent", () => {
  let tmpDir: string | undefined;

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  });

  it("parses valid frontmatter into { name, tools, systemPrompt } with a whitespace-tolerant, order-preserving comma split", async () => {
    tmpDir = makeAgentsDir({
      "example.md": `---
name: example
description: A test agent.
tools: read,   write,edit , bash
---

You are an example agent.

Do the thing.`,
    });

    const agent = await loadAgent(tmpDir, "example");

    expect(agent).toEqual({
      name: "example",
      tools: ["read", "write", "edit", "bash"],
      systemPrompt: "\nYou are an example agent.\n\nDo the thing.",
    });
  });

  it("throws when the target .md file does not exist", async () => {
    tmpDir = makeAgentsDir({});
    await expect(loadAgent(tmpDir, "missing")).rejects.toThrow(/missing/);
  });

  it("throws when the frontmatter is missing a tools: line", async () => {
    tmpDir = makeAgentsDir({
      "no-tools.md": `---
name: no-tools
description: Has no tools field.
---

Body here.`,
    });
    await expect(loadAgent(tmpDir, "no-tools")).rejects.toThrow(/tools/);
  });

  it("throws when the frontmatter block is missing a closing ---", async () => {
    tmpDir = makeAgentsDir({
      "malformed.md": `---
name: malformed
tools: read, write

Body with no closing fence.`,
    });
    await expect(loadAgent(tmpDir, "malformed")).rejects.toThrow(/frontmatter/i);
  });

  it("throws when the file has no leading --- fence", async () => {
    tmpDir = makeAgentsDir({
      "no-fence.md": `name: no-fence
tools: read
---

Body.`,
    });
    await expect(loadAgent(tmpDir, "no-fence")).rejects.toThrow(/frontmatter/i);
  });

  it("loads every agent file shipped in packages/dev/agents and packages/pm/agents", async () => {
    const roots = [path.resolve(__dirname, "../../../dev/agents"), path.resolve(__dirname, "../../../pm/agents")];
    for (const root of roots) {
      const entries = fs.readdirSync(root).filter((f) => f.endsWith(".md"));
      expect(entries.length).toBeGreaterThan(0);
      for (const entry of entries) {
        const name = entry.replace(/\.md$/, "");
        const agent = await loadAgent(root, name);
        expect(agent.name).toBe(name);
        expect(agent.tools.length).toBeGreaterThan(0);
        expect(agent.systemPrompt.length).toBeGreaterThan(0);
      }
    }
  });
});
