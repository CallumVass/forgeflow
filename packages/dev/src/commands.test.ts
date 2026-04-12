import type { CommandDefinition } from "@callumvass/forgeflow-shared/extension";
import { describe, expect, it } from "vitest";
import { commands } from "./commands.js";

function getParseArgs(name: string): NonNullable<CommandDefinition["parseArgs"]> {
  const cmd = commands.find((c) => c.name === name);
  if (!cmd?.parseArgs) throw new Error(`Command "${name}" has no parseArgs`);
  return cmd.parseArgs;
}

const implementParseArgs = getParseArgs("implement");
const reviewParseArgs = getParseArgs("review");
const skillScanParseArgs = getParseArgs("skill-scan");
const skillRecommendParseArgs = getParseArgs("skill-recommend");

describe("implement parseArgs", () => {
  it("does not extract customPrompt from trailing quoted text", () => {
    const { params } = implementParseArgs('42 "check the openapi spec"');
    expect(params ?? {}).not.toHaveProperty("customPrompt");
    expect(params?.issue).toBe("42");
  });

  it("does not extract customPrompt from trailing unquoted text", () => {
    const { params } = implementParseArgs("42 some extra text");
    expect(params ?? {}).not.toHaveProperty("customPrompt");
    expect(params?.issue).toBe("42");
  });
});

describe("skill-scan parseArgs", () => {
  it("passes command, path, issue, target, and json flags through verbatim", () => {
    const { params } = skillScanParseArgs("--command review --path apps/web --issue tailwind --branch feat/ui --json");
    expect(params).toEqual({
      command: "review",
      path: "apps/web",
      issue: "tailwind",
      target: "--branch feat/ui",
      json: true,
    });
  });
});

describe("skill-recommend parseArgs", () => {
  it("passes stage, path, issue, target, limit, and json flags through verbatim", () => {
    const { params } = skillRecommendParseArgs(
      "--for review --path apps/web --issue tailwind --branch feat/ui --limit 5 --json",
    );
    expect(params).toEqual({
      command: "review",
      path: "apps/web",
      issue: "tailwind",
      target: "--branch feat/ui",
      limit: 5,
      json: true,
    });
  });
});

describe("review parseArgs", () => {
  it("does not extract customPrompt from trailing quoted text after target", () => {
    const { params } = reviewParseArgs('123 "look for SQL injection"');
    expect(params ?? {}).not.toHaveProperty("customPrompt");
    expect(params?.target).toBe("123");
  });

  it("does not extract customPrompt from trailing text with --branch flag", () => {
    const { params } = reviewParseArgs('--branch feat/foo "extra instructions"');
    expect(params ?? {}).not.toHaveProperty("customPrompt");
    expect(params?.target).toBe("--branch feat/foo");
  });
});
