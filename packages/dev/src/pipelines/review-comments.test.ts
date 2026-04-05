import { emptyStage, mockForgeflowContext, type StageResult } from "@callumvass/forgeflow-shared";
import { describe, expect, it, vi } from "vitest";
import { buildCommentProposalPrompt, extractGhCommands, proposeAndPostComments } from "./review-comments.js";

describe("buildCommentProposalPrompt", () => {
  it("is a standalone function, not embedded inline in orchestration", () => {
    // Structural assertion: the prompt builder exists as an exported function
    expect(typeof buildCommentProposalPrompt).toBe("function");

    const prompt = buildCommentProposalPrompt("some findings", "42", "owner/repo");
    expect(prompt).toContain("some findings");
    expect(prompt).toContain("42");
    expect(prompt).toContain("owner/repo");
    expect(prompt).toContain("gh api");
  });
});

describe("extractGhCommands", () => {
  it("extracts gh api commands from markdown code blocks", () => {
    const text = `Some text

\`\`\`bash
gh api repos/owner/repo/pulls/1/comments --method POST --field body="fix this"
\`\`\`

More text

\`\`\`bash
gh pr review 1 --request-changes --body "Left a few comments"
\`\`\``;

    const commands = extractGhCommands(text);
    expect(commands).toHaveLength(2);
    expect(commands[0]).toContain("gh api");
    expect(commands[1]).toContain("gh pr review");
  });

  it("ignores code blocks that do not start with gh", () => {
    const text = `\`\`\`bash
echo "hello"
\`\`\`

\`\`\`bash
gh api repos/owner/repo/pulls/1/comments --method POST
\`\`\`

\`\`\`bash
curl https://evil.com
\`\`\``;

    const commands = extractGhCommands(text);
    expect(commands).toHaveLength(1);
    expect(commands[0]).toContain("gh api");
  });
});

describe("proposeAndPostComments", () => {
  it("executes gh commands when user approves", async () => {
    const execFn = vi.fn(async () => "");
    const ctx = mockForgeflowContext({
      hasUI: true,
      ui: {
        editor: vi.fn(async (_title: string, content: string) => content),
        select: vi.fn(async () => "Post comments"),
      },
    });

    const runAgentFn = vi.fn(async (_agent: string, _prompt: string, opts: { stages: StageResult[] }) => {
      const stage = opts.stages.find((s) => s.name === "propose-comments");
      if (stage) stage.output = "```bash\ngh api repos/o/r/pulls/1/comments --method POST\n```";
      return { ...emptyStage("mock"), output: "", status: "done" as const };
    });

    await proposeAndPostComments(
      "findings text",
      { number: "1", repo: "o/r" },
      { cwd: "/tmp", signal: AbortSignal.timeout(5000), stages: [], ctx, runAgentFn, execFn },
    );

    expect(execFn).toHaveBeenCalledWith("gh api repos/o/r/pulls/1/comments --method POST", "/tmp");
  });

  it("skips execution when user cancels editor", async () => {
    const execFn = vi.fn(async () => "");
    const ctx = mockForgeflowContext({
      hasUI: true,
      ui: {
        editor: vi.fn(async () => undefined), // user closes editor
        select: vi.fn(async () => "Post comments"),
      },
    });

    const runAgentFn = vi.fn(async (_agent: string, _prompt: string, opts: { stages: StageResult[] }) => {
      const stage = opts.stages.find((s) => s.name === "propose-comments");
      if (stage) stage.output = "```bash\ngh api repos/o/r/pulls/1/comments\n```";
      return { ...emptyStage("mock"), output: "", status: "done" as const };
    });

    await proposeAndPostComments(
      "findings text",
      { number: "1", repo: "o/r" },
      { cwd: "/tmp", signal: AbortSignal.timeout(5000), stages: [], ctx, runAgentFn, execFn },
    );

    expect(execFn).not.toHaveBeenCalled();
  });

  it("skips execution when user selects Skip", async () => {
    const execFn = vi.fn(async () => "");
    const ctx = mockForgeflowContext({
      hasUI: true,
      ui: {
        editor: vi.fn(async (_title: string, content: string) => content),
        select: vi.fn(async () => "Skip"),
      },
    });

    const runAgentFn = vi.fn(async (_agent: string, _prompt: string, opts: { stages: StageResult[] }) => {
      const stage = opts.stages.find((s) => s.name === "propose-comments");
      if (stage) stage.output = "```bash\ngh api repos/o/r/pulls/1/comments\n```";
      return { ...emptyStage("mock"), output: "", status: "done" as const };
    });

    await proposeAndPostComments(
      "findings text",
      { number: "1", repo: "o/r" },
      { cwd: "/tmp", signal: AbortSignal.timeout(5000), stages: [], ctx, runAgentFn, execFn },
    );

    expect(execFn).not.toHaveBeenCalled();
  });
});
