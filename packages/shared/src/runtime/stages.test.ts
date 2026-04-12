import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { makeStage } from "../testing/index.js";
import { emptyStage, resolveAgentsDir, sumUsage } from "./stages.js";

describe("emptyStage", () => {
  it("returns a pending stage with empty defaults", () => {
    const stage = emptyStage("planner");
    expect(stage).toEqual({
      name: "planner",
      status: "pending",
      messages: [],
      exitCode: -1,
      stderr: "",
      output: "",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 },
    });
  });
});

describe("sumUsage", () => {
  it("aggregates usage across stages", () => {
    const stages = [
      makeStage({ usage: { input: 100, output: 50, cacheRead: 10, cacheWrite: 5, cost: 0.01, turns: 2 } }),
      makeStage({ usage: { input: 200, output: 100, cacheRead: 20, cacheWrite: 10, cost: 0.02, turns: 3 } }),
    ];
    expect(sumUsage(stages)).toEqual({
      input: 300,
      output: 150,
      cacheRead: 30,
      cacheWrite: 15,
      cost: 0.03,
      turns: 5,
    });
  });
});

describe("resolveAgentsDir", () => {
  it("resolves relative to the directory of the URL", () => {
    const url1 = pathToFileURL("/packages/dev/dist/index.js").href;
    const url2 = pathToFileURL("/packages/pm/dist/index.js").href;

    expect(resolveAgentsDir(url1)).toBe(path.resolve("/packages/dev", "agents"));
    expect(resolveAgentsDir(url2)).toBe(path.resolve("/packages/pm", "agents"));
    expect(resolveAgentsDir(url1)).not.toBe(resolveAgentsDir(url2));
  });
});
