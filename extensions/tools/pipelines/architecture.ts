import { TOOLS_READONLY } from "../constants.js";
import { runAgent } from "../run-agent.js";
import { type AnyCtx, emptyStage } from "../types.js";

export async function runArchitecture(cwd: string, signal: AbortSignal, onUpdate: AnyCtx, ctx: AnyCtx) {
  const stages = [emptyStage("architecture-reviewer")];
  const opts = { cwd, signal, stages, pipeline: "architecture", onUpdate };

  // Phase 1: Explore codebase for friction
  const exploreResult = await runAgent(
    "architecture-reviewer",
    "Explore this codebase and identify architectural friction. Present numbered candidates ranked by severity.",
    { ...opts, tools: TOOLS_READONLY },
  );

  if (exploreResult.status === "failed") {
    return {
      content: [{ type: "text" as const, text: `Exploration failed: ${exploreResult.output}` }],
      details: { pipeline: "architecture", stages },
      isError: true,
    };
  }

  // Non-interactive: return candidates
  if (!ctx.hasUI) {
    return {
      content: [{ type: "text" as const, text: exploreResult.output }],
      details: { pipeline: "architecture", stages },
    };
  }

  // Interactive gate: user reviews candidates, can edit/annotate
  const edited = await ctx.ui.editor(
    "Review architecture candidates (edit to highlight your pick)",
    exploreResult.output,
  );
  const action = await ctx.ui.select("Create RFC issue for a candidate?", ["Yes — generate RFC", "Skip"]);

  if (action === "Skip" || action == null) {
    return {
      content: [{ type: "text" as const, text: "Architecture review complete. No RFC created." }],
      details: { pipeline: "architecture", stages },
    };
  }

  // Phase 2: Generate RFC and create GitHub issue
  stages.push(emptyStage("architecture-rfc"));
  const candidateContext = edited ?? exploreResult.output;

  const rfcResult = await runAgent(
    "architecture-reviewer",
    `Based on the following architectural analysis, generate a detailed RFC and create a GitHub issue (with label "architecture") for the highest-priority candidate — or the one the user highlighted/edited.\n\nANALYSIS:\n${candidateContext}`,
    { ...opts, tools: TOOLS_READONLY },
  );

  // Extract issue URL/number from agent output
  const issueMatch = rfcResult.output?.match(/https:\/\/github\.com\/[^\s]+\/issues\/(\d+)/);
  const issueNum = issueMatch?.[1];
  const issueUrl = issueMatch?.[0];
  const summary = issueUrl
    ? `Architecture RFC issue created: ${issueUrl}\n\nRun \`/implement ${issueNum}\` to implement it.`
    : "Architecture RFC issue created.";

  return {
    content: [{ type: "text" as const, text: summary }],
    details: { pipeline: "architecture", stages },
  };
}
