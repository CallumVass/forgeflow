import { describe, expect, it } from "vitest";
import { commands } from "./commands.js";

const implementCmd = commands.find((c) => c.name === "implement")!;
const reviewCmd = commands.find((c) => c.name === "review")!;

describe("implement parseArgs", () => {
  it("does not extract customPrompt from trailing quoted text", () => {
    const result = implementCmd.parseArgs!('42 "check the openapi spec"');
    expect(result.params!).not.toHaveProperty("customPrompt");
    expect(result.params!.issue).toBe("42");
  });

  it("does not extract customPrompt from trailing unquoted text", () => {
    const result = implementCmd.parseArgs!("42 some extra text");
    expect(result.params!).not.toHaveProperty("customPrompt");
    expect(result.params!.issue).toBe("42");
  });
});

describe("review parseArgs", () => {
  it("does not extract customPrompt from trailing quoted text after target", () => {
    const result = reviewCmd.parseArgs!('123 "look for SQL injection"');
    expect(result.params!).not.toHaveProperty("customPrompt");
    expect(result.params!.target).toBe("123");
  });

  it("does not extract customPrompt from trailing text with --branch flag", () => {
    const result = reviewCmd.parseArgs!('--branch feat/foo "extra instructions"');
    expect(result.params!).not.toHaveProperty("customPrompt");
    expect(result.params!.target).toBe("--branch feat/foo");
  });
});
