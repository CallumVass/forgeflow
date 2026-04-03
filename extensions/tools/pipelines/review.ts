import { TOOLS_NO_EDIT, TOOLS_READONLY } from "../constants.js";
import { runAgent } from "../run-agent.js";
import { type AnyCtx, emptyStage, type StageResult } from "../types.js";
import { exec } from "../utils/exec.js";
import { cleanSignal, readSignal, signalExists } from "../utils/signals.js";

/**
 * Shared review logic — used by both standalone /review and chained from /implement.
 * Appends code-reviewer + review-judge stages to the provided stages array.
 */
export async function runReviewInline(
  cwd: string,
  signal: AbortSignal,
  onUpdate: AnyCtx,
  ctx: AnyCtx,
  stages: StageResult[],
  diffCmd = "git diff main...HEAD",
  pipeline = "review",
  options: { prNumber?: string; interactive?: boolean } = {},
): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> {
  const diff = await exec(diffCmd, cwd);

  if (!diff) {
    return { content: [{ type: "text", text: "No changes to review." }] };
  }

  const opts = { cwd, signal, stages, pipeline, onUpdate };

  // Clean up stale findings
  cleanSignal(cwd, "findings");

  // Code reviewer
  stages.push(emptyStage("code-reviewer"));
  await runAgent("code-reviewer", `Review the following diff:\n\n${diff}`, { ...opts, tools: TOOLS_NO_EDIT });

  if (!signalExists(cwd, "findings")) {
    return { content: [{ type: "text", text: "Review passed — no actionable findings." }] };
  }

  // Review judge
  stages.push(emptyStage("review-judge"));
  const findings = readSignal(cwd, "findings") ?? "";
  await runAgent(
    "review-judge",
    `Validate the following code review findings against the actual code:\n\n${findings}`,
    { ...opts, tools: TOOLS_NO_EDIT },
  );

  if (!signalExists(cwd, "findings")) {
    return { content: [{ type: "text", text: "Review passed — judge filtered all findings." }] };
  }

  const validatedFindings = readSignal(cwd, "findings") ?? "";

  // Interactive mode with PR: show findings and proposed gh commands for approval
  if (options.interactive && options.prNumber) {
    const repo = await exec("gh repo view --json nameWithOwner --jq .nameWithOwner", cwd);
    const prNum = options.prNumber;

    const proposalPrompt = `You have validated code review findings for PR #${prNum} in ${repo}.

FINDINGS:
${validatedFindings}

Generate ready-to-run \`gh api\` commands to post each finding as a PR review comment. One command per finding.

Format each as:

**Finding N** — path/to/file.ts:LINE

\`\`\`bash
gh api repos/${repo}/pulls/${prNum}/comments \\
  --method POST \\
  --field body="<comment>" \\
  --field commit_id="$(gh pr view ${prNum} --repo ${repo} --json headRefOid -q .headRefOid)" \\
  --field path="path/to/file.ts" \\
  --field line=LINE \\
  --field side="RIGHT"
\`\`\`

Comment tone rules:
- Write like a teammate, not an auditor. Casual, brief, direct.
- 1-2 short sentences max. Lead with the suggestion, not the problem.
- Use "might be worth..." / "could we..." / "what about..." / "small thing:"
- No em dashes, no "Consider...", no "Note that...", no hedging filler.
- Use GitHub \`\`\`suggestion\`\`\` blocks when proposing code changes.
- Only generate commands for findings with a specific file + line.

After the comments, add the review decision command:

\`\`\`bash
gh pr review ${prNum} --request-changes --body "Left a few comments" --repo ${repo}
\`\`\`

Output ONLY the commands, no other text.`;

    stages.push(emptyStage("propose-comments"));
    await runAgent("review-judge", proposalPrompt, { cwd, signal, stages, pipeline, onUpdate, tools: TOOLS_READONLY });

    const commentStage = stages.find((s) => s.name === "propose-comments");
    const proposedCommands = commentStage?.output || "";

    if (proposedCommands && ctx.hasUI) {
      const reviewed = await ctx.ui.editor(
        `Review PR comments for PR #${prNum} (edit or close to skip)`,
        `${validatedFindings}\n\n---\n\nProposed commands (run these to post):\n\n${proposedCommands}`,
      );

      if (reviewed != null) {
        const action = await ctx.ui.select("Post these review comments?", ["Post comments", "Skip"]);
        if (action === "Post comments") {
          const commands = reviewed.match(/```bash\n([\s\S]*?)```/g) || [];
          for (const block of commands) {
            const cmd = block
              .replace(/```bash\n/, "")
              .replace(/```$/, "")
              .trim();
            if (cmd.startsWith("gh ")) {
              await exec(cmd, cwd);
            }
          }
        }
      }
    }
  }

  return { content: [{ type: "text", text: validatedFindings }], isError: true };
}

export async function runReview(cwd: string, target: string, signal: AbortSignal, onUpdate: AnyCtx, ctx: AnyCtx) {
  const stages: StageResult[] = [];

  let diffCmd = "git diff main...HEAD";
  let prNumber: string | undefined;

  if (target.match(/^\d+$/)) {
    diffCmd = `gh pr diff ${target}`;
    prNumber = target;
  } else if (target.startsWith("--branch")) {
    const branch = target.replace("--branch", "").trim() || "HEAD";
    diffCmd = `git diff main...${branch}`;
  } else {
    // Try to detect PR from current branch
    const pr = await exec("gh pr view --json number --jq .number 2>/dev/null", cwd);
    if (pr && pr !== "") prNumber = pr;
  }

  const result = await runReviewInline(cwd, signal, onUpdate, ctx, stages, diffCmd, "review", {
    prNumber,
    interactive: ctx.hasUI,
  });
  return { ...result, details: { pipeline: "review", stages } };
}
