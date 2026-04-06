import { runAgent } from "@callumvass/forgeflow-shared/agent";
import { TOOLS_READONLY } from "@callumvass/forgeflow-shared/constants";
import { emptyStage, type PipelineContext, pipelineResult, toAgentOpts } from "@callumvass/forgeflow-shared/types";
import { AGENTS_DIR } from "../resolve.js";

/**
 * Parse numbered candidates from the architecture reviewer output.
 * Matches headings like "### 1. Short name" or "**1. Short name**".
 */
function parseCandidates(text: string): { label: string; body: string }[] {
  // Split on markdown headings like "### 1." or bold patterns like "**1."
  const pattern = /^(?:#{1,4}\s+)?(\d+)\.\s+(.+)$/gm;
  const matches = [...text.matchAll(pattern)];
  if (matches.length === 0) return [];

  const results: { label: string; body: string }[] = [];
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i] as RegExpMatchArray;
    const num = match[1] as string;
    const name = (match[2] as string).replace(/[*#]+/g, "").trim();
    const start = match.index as number;
    const end = i + 1 < matches.length ? ((matches[i + 1] as RegExpMatchArray).index as number) : text.length;
    const body = text.slice(start, end).trim();
    results.push({ label: `${num}. ${name}`, body });
  }

  return results;
}

export async function runArchitecture(pctx: PipelineContext) {
  const { ctx } = pctx;
  const stages = [emptyStage("architecture-reviewer")];
  const opts = toAgentOpts(pctx, { agentsDir: AGENTS_DIR, stages, pipeline: "architecture" });

  // Phase 1: Explore codebase for friction
  const exploreResult = await runAgent(
    "architecture-reviewer",
    "Explore this codebase and identify architectural friction. Present numbered candidates ranked by severity.",
    { ...opts, tools: TOOLS_READONLY },
  );

  if (exploreResult.status === "failed") {
    return pipelineResult(`Exploration failed: ${exploreResult.output}`, "architecture", stages, true);
  }

  // Non-interactive: return candidates
  if (!ctx.hasUI) {
    return pipelineResult(exploreResult.output, "architecture", stages);
  }

  // Interactive gate: user reviews candidates, can edit/annotate
  const edited = await ctx.ui.editor(
    "Review architecture candidates (edit to highlight your pick)",
    exploreResult.output,
  );
  const candidateContext = edited ?? exploreResult.output;

  // Parse numbered candidates from the output (e.g. "### 1. Short name")
  const candidates = parseCandidates(candidateContext);
  const selectOptions =
    candidates.length > 1
      ? [...candidates.map((c) => c.label), "All candidates", "Skip"]
      : candidates.length === 1
        ? [(candidates[0] as { label: string; body: string }).label, "Skip"]
        : ["Yes — generate RFC", "Skip"];

  const action = await ctx.ui.select("Create RFC issues for which candidates?", selectOptions);

  if (action === "Skip" || action == null) {
    return pipelineResult("Architecture review complete. No RFC created.", "architecture", stages);
  }

  // Determine which candidates to create RFCs for
  let selectedCandidates: { label: string; body: string }[];
  if (action === "All candidates") {
    selectedCandidates = candidates;
  } else if (action === "Yes — generate RFC") {
    // Fallback when no candidates were parsed — send full context
    selectedCandidates = [{ label: "RFC", body: candidateContext }];
  } else {
    const match = candidates.find((c) => c.label === action);
    selectedCandidates = match ? [match] : [{ label: "RFC", body: candidateContext }];
  }

  // Phase 2: Generate RFC and create GitHub issue for each selected candidate
  const createdIssues: string[] = [];

  for (const candidate of selectedCandidates) {
    const stageName = `architecture-rfc-${selectedCandidates.indexOf(candidate) + 1}`;
    stages.push(emptyStage(stageName));

    const rfcResult = await runAgent(
      "architecture-reviewer",
      `Based on the following architectural analysis, generate a detailed RFC and create a GitHub issue (with label "architecture") for this specific candidate.\n\nCANDIDATE:\n${candidate.body}\n\nFULL ANALYSIS (for context):\n${candidateContext}`,
      { ...opts, stageName, tools: TOOLS_READONLY },
    );

    const issueMatch = rfcResult.output?.match(/https:\/\/github\.com\/[^\s]+\/issues\/(\d+)/);
    const issueUrl = issueMatch?.[0];
    const issueNum = issueMatch?.[1];
    if (issueUrl) {
      createdIssues.push(`- ${issueUrl} — run \`/implement ${issueNum}\` to implement`);
    } else {
      createdIssues.push(`- ${candidate.label}: RFC created (no issue URL found in output)`);
    }
  }

  const summary =
    createdIssues.length === 1
      ? `Architecture RFC issue created:\n${createdIssues[0]}`
      : `Architecture RFC issues created (${createdIssues.length}):\n${createdIssues.join("\n")}`;

  return pipelineResult(summary, "architecture", stages);
}
