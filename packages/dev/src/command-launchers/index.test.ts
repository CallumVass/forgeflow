import { mockForgeflowContext } from "@callumvass/forgeflow-shared/testing";
import { describe, expect, it, vi } from "vitest";
import { launchImplement, launchReview, reviewArgumentCompletions, withLaunchers } from "./index.js";

function mockHelpers(responses: Record<string, { stdout: string; code?: number }> = {}) {
  return {
    exec: vi.fn(async (command: string, args: string[] = []) => {
      const key = `${command} ${args.join(" ")}`.trim();
      const match = Object.entries(responses).find(([pattern]) => key.includes(pattern));
      if (match) {
        return {
          stdout: match[1].stdout,
          stderr: "",
          code: match[1].code ?? 0,
          killed: false,
        };
      }
      return { stdout: "", stderr: "", code: 1, killed: false };
    }),
  };
}

describe("command launchers", () => {
  it("launchImplement offers current branch and selected flags", async () => {
    const helpers = mockHelpers({
      "git branch --show-current": { stdout: "feat/issue-42" },
      "gh issue list": { stdout: JSON.stringify([{ number: 42, title: "Test issue" }]) },
    });
    const select = vi
      .fn<(...args: unknown[]) => Promise<string | undefined>>()
      .mockResolvedValueOnce("Current branch: feat/issue-42")
      .mockResolvedValueOnce("Skip review");
    const ctx = mockForgeflowContext({ hasUI: true, ui: { select } });

    const result = await launchImplement(ctx, helpers);

    expect(result).toEqual({
      params: { skipReview: true },
      suffix:
        "No issue number provided — the tool will detect it from the current branch. Do NOT ask for an issue number.",
    });
  });

  it("launchReview resolves the current PR and lets the user pick strict mode", async () => {
    const helpers = mockHelpers({
      "gh pr view --json number,title": { stdout: JSON.stringify({ number: 7, title: "Review me" }) },
      "git branch --show-current": { stdout: "feat/foo" },
      "gh pr list": { stdout: JSON.stringify([]) },
    });
    const select = vi
      .fn<(...args: unknown[]) => Promise<string | undefined>>()
      .mockResolvedValueOnce("Current PR #7: Review me")
      .mockResolvedValueOnce("Strict blocking review");
    const ctx = mockForgeflowContext({ hasUI: true, ui: { select } });

    const result = await launchReview(ctx, helpers, { commandName: "review", strict: false });

    expect(result).toEqual({
      params: { target: "7", strict: true },
      suffix: "Do not interpret the target — pass it as-is.",
    });
  });

  it("withLaunchers adds interactive launchers to implement and review commands only", () => {
    const commands = withLaunchers([
      { name: "implement", description: "", pipeline: "implement" },
      { name: "implement-all", description: "", pipeline: "implement-all" },
      { name: "review", description: "", pipeline: "review" },
    ]);

    expect(commands[0]?.launch).toBeDefined();
    expect(commands[1]?.launch).toBeUndefined();
    expect(commands[2]?.launch).toBeDefined();
  });

  it("reviewArgumentCompletions suggests static review flags", () => {
    expect(reviewArgumentCompletions("--s")).toEqual([{ value: "--strict", label: "--strict" }]);
    expect(reviewArgumentCompletions("--b")).toEqual([{ value: "--branch ", label: "--branch " }]);
  });
});
