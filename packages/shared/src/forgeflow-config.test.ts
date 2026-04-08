import * as fs from "node:fs";
import * as path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type ForgeflowConfig, loadForgeflowConfig, mergeConfigs, VALID_THINKING_LEVELS } from "./forgeflow-config.js";
import { setupIsolatedHomeFixture } from "./test-utils.js";

describe("mergeConfigs", () => {
  it("replaces whole agent entries from global with project entries of the same name, preserves non-overlapping global entries, and tolerates empty inputs", () => {
    const global: ForgeflowConfig = {
      agents: {
        planner: { model: "claude-haiku-4-5", thinkingLevel: "low" },
        implementor: { model: "claude-sonnet-4-5", thinkingLevel: "medium" },
      },
    };
    const project: ForgeflowConfig = {
      agents: {
        planner: { model: "claude-opus-4-5" }, // entry-level replacement: loses thinkingLevel
        "code-reviewer": { thinkingLevel: "high" },
      },
    };

    expect(mergeConfigs(global, project)).toEqual({
      agents: {
        planner: { model: "claude-opus-4-5" },
        implementor: { model: "claude-sonnet-4-5", thinkingLevel: "medium" },
        "code-reviewer": { thinkingLevel: "high" },
      },
    });

    // Empty inputs tolerated.
    expect(mergeConfigs({}, {})).toEqual({ agents: {} });
    expect(mergeConfigs({}, project)).toEqual({ agents: project.agents });
    expect(mergeConfigs(global, {})).toEqual({ agents: global.agents });
  });
});

describe("loadForgeflowConfig", () => {
  const fixture = setupIsolatedHomeFixture("cfg");
  let nested: string;
  let warn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    nested = path.join(fixture.cwdDir, "packages", "dev", "src");
    fs.mkdirSync(nested, { recursive: true });
    warn = vi.fn();
  });

  function writeGlobal(config: unknown): void {
    const dir = path.join(fixture.homeDir, ".pi", "agent");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "forgeflow.json"), JSON.stringify(config), "utf-8");
  }

  function writeProject(config: unknown, dir = fixture.cwdDir): void {
    fs.writeFileSync(path.join(dir, ".forgeflow.json"), JSON.stringify(config), "utf-8");
  }

  it("returns an empty config when no files are present", () => {
    const result = loadForgeflowConfig(nested, warn);
    expect(result).toEqual({ agents: {} });
    expect(warn).not.toHaveBeenCalled();
  });

  it("walks up from a nested cwd to find .forgeflow.json and overrides the global config at the agent-entry level", () => {
    writeGlobal({
      agents: {
        planner: { model: "claude-haiku-4-5", thinkingLevel: "low" },
        implementor: { model: "claude-sonnet-4-5", thinkingLevel: "medium" },
      },
    });
    writeProject({
      agents: {
        planner: { model: "claude-opus-4-5", thinkingLevel: "high" },
      },
    });

    const result = loadForgeflowConfig(nested, warn);

    expect(result).toEqual({
      agents: {
        planner: { model: "claude-opus-4-5", thinkingLevel: "high" },
        implementor: { model: "claude-sonnet-4-5", thinkingLevel: "medium" },
      },
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it("drops invalid thinkingLevel values but keeps the sibling model field and invokes warn once per drop", () => {
    writeProject({
      agents: {
        planner: { model: "claude-opus-4-5", thinkingLevel: "turbo" },
        implementor: { thinkingLevel: "HIGH" },
      },
    });

    const result = loadForgeflowConfig(nested, warn);

    expect(result).toEqual({
      agents: {
        planner: { model: "claude-opus-4-5" },
        implementor: {},
      },
    });
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("accepts every documented thinking level", () => {
    const agents: Record<string, { thinkingLevel: string }> = {};
    for (const level of VALID_THINKING_LEVELS) agents[`agent-${level}`] = { thinkingLevel: level };
    writeProject({ agents });

    const result = loadForgeflowConfig(nested, warn);

    expect(result.agents).toEqual(agents);
    expect(warn).not.toHaveBeenCalled();
  });

  it("returns an empty config and invokes warn once when the project JSON is malformed", () => {
    fs.writeFileSync(path.join(fixture.cwdDir, ".forgeflow.json"), "{ not json", "utf-8");

    const result = loadForgeflowConfig(nested, warn);

    expect(result).toEqual({ agents: {} });
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
