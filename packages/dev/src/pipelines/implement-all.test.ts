import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("implement-all.ts", () => {
  it("uses GitWorkflow instead of inline exec() for git/gh PR operations", () => {
    const src = readFileSync(resolve(__dirname, "implement-all.ts"), "utf-8");

    // Should NOT have direct exec calls for merge/checkout operations
    expect(src).not.toMatch(/exec\([^)]*gh pr merge/);
    expect(src).not.toMatch(/exec\([^)]*gh pr list/);
    expect(src).not.toMatch(/exec\([^)]*gh pr view/);
    expect(src).not.toMatch(/exec\([^)]*git checkout main/);

    // Should import from git-workflow
    expect(src).toContain("git-workflow");
  });
});
