import { emptyStage, type StageResult } from "@callumvass/forgeflow-shared/pipeline";
import { mockForgeflowContext, mockPipelineContext } from "@callumvass/forgeflow-shared/testing";
import { describe, expect, it, vi } from "vitest";
import { buildCommentProposalPrompt, extractGhCommands, proposeAndPostComments } from "./comments.js";

/** Create a mock agent that injects `stageOutput` into the requested stage. */
function mockCommentAgent(stageOutput: string) {
  return vi.fn(async (_agent: string, _prompt: string, opts: { stageName?: string; stages: StageResult[] }) => {
    const stage = opts.stages.find((s) => s.name === (opts.stageName ?? "propose-comments"));
    if (stage) stage.output = stageOutput;
    return { ...emptyStage(opts.stageName ?? "mock"), output: "", status: "done" as const };
  });
}

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
    const pctx = mockPipelineContext({
      cwd: "/tmp",
      ctx: mockForgeflowContext({
        hasUI: true,
        cwd: "/tmp",
        ui: {
          editor: vi.fn(async (_title: string, content: string) => content),
          select: vi.fn(async () => "Post comments"),
        },
      }),
    });

    const runAgentFn = mockCommentAgent("```bash\ngh api repos/o/r/pulls/1/comments --method POST\n```");

    await proposeAndPostComments(
      "findings text",
      { number: "1", repo: "o/r" },
      { ...pctx, stages: [], runAgentFn, execFn },
    );

    expect(runAgentFn).toHaveBeenCalledWith(
      "review-judge",
      expect.any(String),
      expect.objectContaining({ stageName: "propose-comments" }),
    );
    expect(execFn).toHaveBeenCalledWith("gh api repos/o/r/pulls/1/comments --method POST", "/tmp");
  });

  it("skips execution when user cancels editor", async () => {
    const execFn = vi.fn(async () => "");
    const pctx = mockPipelineContext({
      cwd: "/tmp",
      ctx: mockForgeflowContext({
        hasUI: true,
        cwd: "/tmp",
        ui: {
          editor: vi.fn(async () => undefined), // user closes editor
          select: vi.fn(async () => "Post comments"),
        },
      }),
    });

    const runAgentFn = mockCommentAgent("```bash\ngh api repos/o/r/pulls/1/comments\n```");

    await proposeAndPostComments(
      "findings text",
      { number: "1", repo: "o/r" },
      { ...pctx, stages: [], runAgentFn, execFn },
    );

    expect(execFn).not.toHaveBeenCalled();
  });

  it("skips execution when user selects Skip", async () => {
    const execFn = vi.fn(async () => "");
    const pctx = mockPipelineContext({
      cwd: "/tmp",
      ctx: mockForgeflowContext({
        hasUI: true,
        cwd: "/tmp",
        ui: {
          editor: vi.fn(async (_title: string, content: string) => content),
          select: vi.fn(async () => "Skip"),
        },
      }),
    });

    const runAgentFn = mockCommentAgent("```bash\ngh api repos/o/r/pulls/1/comments\n```");

    await proposeAndPostComments(
      "findings text",
      { number: "1", repo: "o/r" },
      { ...pctx, stages: [], runAgentFn, execFn },
    );

    expect(execFn).not.toHaveBeenCalled();
  });
});
