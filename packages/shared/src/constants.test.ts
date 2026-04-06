import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveAgentsDir } from "./constants.js";

describe("resolveAgentsDir", () => {
  it("returns a path ending in /agents when given a valid file:// URL", () => {
    const fakeUrl = pathToFileURL("/some/package/dist/index.js").href;
    const result = resolveAgentsDir(fakeUrl);
    expect(result).toMatch(/\/agents$/);
  });

  it("resolves relative to the directory of the URL passed in, not relative to the shared package", () => {
    const url1 = pathToFileURL("/packages/dev/dist/index.js").href;
    const url2 = pathToFileURL("/packages/pm/dist/index.js").href;

    const result1 = resolveAgentsDir(url1);
    const result2 = resolveAgentsDir(url2);

    expect(result1).toBe(path.resolve("/packages/dev", "agents"));
    expect(result2).toBe(path.resolve("/packages/pm", "agents"));
    expect(result1).not.toBe(result2);
  });
});
