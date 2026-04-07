import { resolveRunAgent } from "@callumvass/forgeflow-shared/agent";
import {
  emptyStage,
  type PipelineContext,
  pipelineResult,
  type RunAgentFn,
  TOOLS_READONLY,
  toAgentOpts,
} from "@callumvass/forgeflow-shared/pipeline";

/**
 * A single architectural finding parsed from reviewer output: a short label
 * (e.g. "1. High coupling in auth module") and the full markdown body.
 */
export type ArchitectureCandidate = { label: string; body: string };

/**
 * Parse numbered candidates from the architecture reviewer output.
 * Matches headings like "### 1. Short name" or "**1. Short name**".
 */
export function parseCandidates(text: string): ArchitectureCandidate[] {
  // Split on markdown headings like "### 1." or bold patterns like "**1."
  const pattern = /^(?:#{1,4}\s+)?(\d+)\.\s+(.+)$/gm;
  const matches = [...text.matchAll(pattern)];
  if (matches.length === 0) return [];

  const results: ArchitectureCandidate[] = [];
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

export async function runArchitecture(pctx: PipelineContext, opts?: { runAgentFn?: RunAgentFn }) {
  const { ctx } = pctx;
  const stages = [emptyStage("architecture-reviewer")];
  const agentOpts = toAgentOpts(pctx, { stages, pipeline: "architecture" });

  const runAgentFn = await resolveRunAgent(opts?.runAgentFn);

  // Phase 1: Explore codebase for friction
  const exploreResult = await runAgentFn(
    "architecture-reviewer",
    "Explore this codebase and identify architectural friction. Present numbered candidates ranked by severity.",
    { ...agentOpts, tools: TOOLS_READONLY },
  );

  if (exploreResult.status === "failed") {
    return pipelineResult(`Exploration failed: ${exploreResult.output}`, "architecture", stages, true);
  }

  // Parse numbered candidates from the reviewer output
  const candidates = parseCandidates(exploreResult.output);

  const reviewerOutput = candidates.length > 0 ? candidates.map((c) => c.body).join("\n\n") : exploreResult.output;

  // Non-interactive: return reviewer output
  if (!ctx.hasUI) {
    return pipelineResult(reviewerOutput, "architecture", stages);
  }

  const edited = await ctx.ui.editor("Review architecture candidates (edit to highlight your pick)", reviewerOutput);
  const candidateContext = edited ?? reviewerOutput;

  // Re-parse after editing (user may have changed text)
  const editedCandidates = parseCandidates(candidateContext);
  const displayCandidates = editedCandidates.length > 0 ? editedCandidates : candidates;

  const selectOptions =
    displayCandidates.length > 1
      ? [...displayCandidates.map((c) => c.label), "All candidates", "Skip"]
      : displayCandidates.length === 1
        ? [(displayCandidates[0] as ArchitectureCandidate).label, "Skip"]
        : ["Yes — generate RFC", "Skip"];

  const action = await ctx.ui.select("Create RFC issues for which candidates?", selectOptions);

  if (action === "Skip" || action == null) {
    return pipelineResult("Architecture review complete. No RFC created.", "architecture", stages);
  }

  // Determine which candidates to create RFCs for
  let selectedCandidates: ArchitectureCandidate[];
  if (action === "All candidates") {
    selectedCandidates = displayCandidates;
  } else if (action === "Yes — generate RFC") {
    selectedCandidates = [{ label: "RFC", body: candidateContext }];
  } else {
    const match = displayCandidates.find((c) => c.label === action);
    selectedCandidates = match ? [match] : [{ label: "RFC", body: candidateContext }];
  }

  // Phase 2: Generate RFC and create GitHub issue for each selected candidate
  const createdIssues: string[] = [];

  for (const [i, candidate] of selectedCandidates.entries()) {
    const stageName = `architecture-rfc-${i + 1}`;
    stages.push(emptyStage(stageName));

    const rfcResult = await runAgentFn(
      "architecture-reviewer",
      `Based on the following architectural analysis, generate a detailed RFC and create a GitHub issue (with label "architecture") for this specific candidate.\n\nCANDIDATE:\n${candidate.body}\n\nFULL ANALYSIS (for context):\n${candidateContext}`,
      { ...agentOpts, stageName, tools: TOOLS_READONLY },
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
