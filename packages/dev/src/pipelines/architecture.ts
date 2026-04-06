import { TOOLS_READONLY } from "@callumvass/forgeflow-shared/constants";
import { type PipelineContext, toAgentOpts } from "@callumvass/forgeflow-shared/context";
import { resolveRunAgent } from "@callumvass/forgeflow-shared/di";
import { emptyStage, pipelineResult, type RunAgentFn } from "@callumvass/forgeflow-shared/stage";

/**
 * Parse numbered candidates from the architecture reviewer output.
 * Matches headings like "### 1. Short name" or "**1. Short name**".
 */
export function parseCandidates(text: string): { label: string; body: string }[] {
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

/**
 * Parse a judge agent's output for a KEEP/REJECT verdict.
 * Defaults to "keep" if no verdict found (fail-open).
 */
export function parseJudgeVerdict(output: string): "keep" | "reject" {
  if (/VERDICT:\s*REJECT/i.test(output)) return "reject";
  return "keep";
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

  // Phase 1.5: Parse and judge each candidate
  const candidates = parseCandidates(exploreResult.output);
  const validatedCandidates: typeof candidates = [];

  for (const [i, candidate] of candidates.entries()) {
    const judgeStageName = `architecture-judge-${i + 1}`;
    stages.push(emptyStage(judgeStageName));
    const judgeResult = await runAgentFn(
      "architecture-judge",
      `Validate this architecture finding against the actual codebase.\n\nCANDIDATE:\n${candidate.body}\n\nFULL ANALYSIS:\n${exploreResult.output}`,
      { ...agentOpts, stageName: judgeStageName, tools: TOOLS_READONLY },
    );
    if (parseJudgeVerdict(judgeResult.output) !== "reject") {
      validatedCandidates.push(candidate);
    }
  }

  // If all candidates were rejected, return early
  if (candidates.length > 0 && validatedCandidates.length === 0) {
    return pipelineResult(
      "Architecture review complete — no actionable findings survived validation.",
      "architecture",
      stages,
    );
  }

  const validatedOutput =
    validatedCandidates.length > 0 ? validatedCandidates.map((c) => c.body).join("\n\n") : exploreResult.output;

  // Non-interactive: return validated output
  if (!ctx.hasUI) {
    return pipelineResult(validatedOutput, "architecture", stages);
  }

  const edited = await ctx.ui.editor("Review architecture candidates (edit to highlight your pick)", validatedOutput);
  const candidateContext = edited ?? validatedOutput;

  // Re-parse after editing (user may have changed text)
  const editedCandidates = parseCandidates(candidateContext);
  const displayCandidates = editedCandidates.length > 0 ? editedCandidates : validatedCandidates;

  const selectOptions =
    displayCandidates.length > 1
      ? [...displayCandidates.map((c) => c.label), "All candidates", "Skip"]
      : displayCandidates.length === 1
        ? [(displayCandidates[0] as { label: string; body: string }).label, "Skip"]
        : ["Yes — generate RFC", "Skip"];

  const action = await ctx.ui.select("Create RFC issues for which candidates?", selectOptions);

  if (action === "Skip" || action == null) {
    return pipelineResult("Architecture review complete. No RFC created.", "architecture", stages);
  }

  // Determine which candidates to create RFCs for
  let selectedCandidates: { label: string; body: string }[];
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
