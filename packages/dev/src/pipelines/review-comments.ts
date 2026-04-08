import { emptyStage, type PipelineContext, type StageResult, toAgentOpts } from "@callumvass/forgeflow-shared/pipeline";

/**
 * Build the prompt for the comment-proposal agent call.
 * Extracted so the template is not embedded inline in orchestration.
 */
export function buildCommentProposalPrompt(findings: string, prNum: string, repo: string): string {
  return `You have validated code review findings for PR #${prNum} in ${repo}.

FINDINGS:
${findings}

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
}

/**
 * Extract bash code blocks that start with `gh` from markdown text.
 * Security guard: non-gh commands are ignored.
 */
export function extractGhCommands(text: string): string[] {
  const blocks = text.match(/```bash\n([\s\S]*?)```/g) || [];
  const commands: string[] = [];
  for (const block of blocks) {
    const cmd = block
      .replace(/```bash\n/, "")
      .replace(/```$/, "")
      .trim();
    if (cmd.startsWith("gh ")) {
      commands.push(cmd);
    }
  }
  return commands;
}

/**
 * Propose PR review comments via an agent call, let the user review/edit,
 * and execute approved `gh api` commands.
 */
export async function proposeAndPostComments(
  findings: string,
  pr: { number: string; repo: string },
  opts: PipelineContext & {
    stages: StageResult[];
    pipeline?: string;
  },
): Promise<void> {
  const { cwd, ctx, stages, runAgentFn, execFn } = opts;
  const pipeline = opts.pipeline ?? "review";

  const agentOpts = toAgentOpts(opts, { stages, pipeline });

  const proposalPrompt = buildCommentProposalPrompt(findings, pr.number, pr.repo);

  stages.push(emptyStage("propose-comments"));
  await runAgentFn("review-judge", proposalPrompt, agentOpts);

  const commentStage = stages.find((s) => s.name === "propose-comments");
  const proposedCommands = commentStage?.output || "";

  if (!proposedCommands || !ctx.hasUI) return;

  const reviewed = await ctx.ui.editor(
    `Review PR comments for PR #${pr.number} (edit or close to skip)`,
    `${findings}\n\n---\n\nProposed commands (run these to post):\n\n${proposedCommands}`,
  );

  if (reviewed == null) return;

  const action = await ctx.ui.select("Post these review comments?", ["Post comments", "Skip"]);
  if (action !== "Post comments") return;

  const commands = extractGhCommands(reviewed);
  for (const cmd of commands) {
    await execFn(cmd, cwd);
  }
}
