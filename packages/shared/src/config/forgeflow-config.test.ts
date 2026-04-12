import * as fs from "node:fs";
import * as path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedHomeFixture } from "../testing/index.js";
import {
  DEFAULT_SESSIONS,
  DEFAULT_SKILLS,
  type ForgeflowConfig,
  loadForgeflowConfig,
  mergeConfigs,
  VALID_THINKING_LEVELS,
} from "./forgeflow-config.js";

/**
 * Factory for the pair of on-disk config writers used by the
 * `loadForgeflowConfig` and `sessions config` suites. Both suites need the
 * same two helpers against different fixtures — the factory captures the
 * fixture handle via closure so test bodies can call `writeGlobal({...})` /
 * `writeProject({...})` without re-typing path-joining boilerplate.
 */
function createConfigWriters(fixture: { homeDir: string; cwdDir: string }) {
  return {
    writeGlobal(config: unknown): void {
      const dir = path.join(fixture.homeDir, ".pi", "agent");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "forgeflow.json"), JSON.stringify(config), "utf-8");
    },
    writeProject(config: unknown, dir: string = fixture.cwdDir): void {
      fs.writeFileSync(path.join(dir, ".forgeflow.json"), JSON.stringify(config), "utf-8");
    },
  };
}

describe("mergeConfigs", () => {
  it("leaves sessions / skills undefined when neither side supplies them (loader back-fills defaults separately)", () => {
    expect(mergeConfigs({}, {})).toEqual({ agents: {} });
    expect(mergeConfigs({ agents: {} }, { agents: {} })).toEqual({ agents: {} });
  });

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
  const { writeGlobal, writeProject } = createConfigWriters(fixture);
  let nested: string;
  let warn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    nested = path.join(fixture.cwdDir, "packages", "dev", "src");
    fs.mkdirSync(nested, { recursive: true });
    warn = vi.fn();
  });

  it("returns an empty config with sessions defaults when no files are present", () => {
    const result = loadForgeflowConfig(nested, warn);
    expect(result).toEqual({ agents: {}, sessions: DEFAULT_SESSIONS, skills: DEFAULT_SKILLS });
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
      sessions: DEFAULT_SESSIONS,
      skills: DEFAULT_SKILLS,
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
      sessions: DEFAULT_SESSIONS,
      skills: DEFAULT_SKILLS,
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

    expect(result).toEqual({ agents: {}, sessions: DEFAULT_SESSIONS, skills: DEFAULT_SKILLS });
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("skills config", () => {
  const fixture = setupIsolatedHomeFixture("skills");
  const { writeProject } = createConfigWriters(fixture);
  let warn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    warn = vi.fn();
  });

  it("merges skills field-by-field and concatenates extraPaths in global→project order", () => {
    const merged = mergeConfigs(
      { skills: { enabled: true, extraPaths: ["/global/a"], maxSelected: 2 } },
      { skills: { extraPaths: ["/project/b"], maxSelected: 5 } },
    );
    expect(merged.skills).toEqual({ enabled: true, extraPaths: ["/global/a", "/project/b"], maxSelected: 5 });
  });

  it("backfills skills defaults when neither file sets the block", () => {
    const result = loadForgeflowConfig(fixture.cwdDir, warn);
    expect(result.skills).toEqual(DEFAULT_SKILLS);
    expect(warn).not.toHaveBeenCalled();
  });

  it("resolves project-relative extraPaths against the config file location", () => {
    writeProject({ skills: { extraPaths: ["./custom-skills"], maxSelected: 2 } });

    const result = loadForgeflowConfig(fixture.cwdDir, warn);

    expect(result.skills).toEqual({
      enabled: true,
      extraPaths: [path.join(fixture.cwdDir, "custom-skills")],
      maxSelected: 2,
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it("drops invalid skills fields with warnings and falls back to defaults", () => {
    writeProject({ skills: { enabled: "yes", extraPaths: "oops", maxSelected: -2 } });

    const result = loadForgeflowConfig(fixture.cwdDir, warn);

    expect(result.skills).toEqual(DEFAULT_SKILLS);
    expect(warn).toHaveBeenCalledTimes(3);
  });
});

describe("sessions config", () => {
  const fixture = setupIsolatedHomeFixture("sessions");
  const { writeGlobal, writeProject } = createConfigWriters(fixture);
  let warn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    warn = vi.fn();
  });

  it("merges sessions field-by-field so project can override one knob without losing sibling fields", () => {
    // mergeConfigs field-level semantics: unlike `agents` (entry-level replacement),
    // `sessions` fields merge individually so users can tune one retention knob
    // without re-typing every field.
    const merged = mergeConfigs(
      { sessions: { persist: true, archiveRuns: 50, archiveMaxAge: 90 } },
      { sessions: { archiveRuns: 5 } },
    );
    expect(merged.sessions).toEqual({ persist: true, archiveRuns: 5, archiveMaxAge: 90 });
  });

  it("backfills sessions defaults when neither file sets the block", () => {
    const result = loadForgeflowConfig(fixture.cwdDir, warn);
    expect(result.sessions).toEqual(DEFAULT_SESSIONS);
    expect(DEFAULT_SESSIONS).toEqual({ persist: true, archiveRuns: 20, archiveMaxAge: 30 });
    expect(warn).not.toHaveBeenCalled();
  });

  it("applies sessions.persist=false opt-out from the global file even when the project sets only retention", () => {
    writeGlobal({ sessions: { persist: false, archiveRuns: 10 } });
    writeProject({ sessions: { archiveMaxAge: 7 } });

    const result = loadForgeflowConfig(fixture.cwdDir, warn);

    expect(result.sessions).toEqual({ persist: false, archiveRuns: 10, archiveMaxAge: 7 });
    expect(warn).not.toHaveBeenCalled();
  });

  it("drops non-numeric / non-boolean sessions fields with a warning and falls back to defaults", () => {
    writeProject({
      sessions: { persist: "yes", archiveRuns: "lots", archiveMaxAge: -3 },
    });

    const result = loadForgeflowConfig(fixture.cwdDir, warn);

    expect(result.sessions).toEqual(DEFAULT_SESSIONS);
    expect(warn).toHaveBeenCalledTimes(3);
  });
});
