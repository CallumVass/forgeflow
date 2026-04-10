import {
  emptyStage,
  type PipelineContext,
  pipelineResult,
  toAgentOpts,
  withRunLifecycle,
} from "@callumvass/forgeflow-shared/pipeline";
import { ARCHITECTURE_LABEL } from "../../issues/index.js";
import { type ArchitectureCandidate, parseCandidates } from "../architecture-review/index.js";
import { pickArchitectureCandidates } from "./candidate-picker.js";

export async function runArchitecture(pctx: PipelineContext) {
  return withRunLifecycle(pctx, "architecture", (innerPctx) => runArchitectureInner(innerPctx));
}

async function runArchitectureInner(pctx: PipelineContext) {
  const { ctx, runAgentFn } = pctx;
  const stages = [emptyStage("architecture-reviewer")];
  const agentOpts = toAgentOpts(pctx, { stages, pipeline: "architecture" });

  // Phase 1: Explore codebase for friction
  const exploreResult = await runAgentFn(
    "architecture-reviewer",
    "Explore this codebase and identify architectural friction. Present numbered candidates ranked by severity.",
    agentOpts,
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

  let selectedCandidates: ArchitectureCandidate[];

  if (displayCandidates.length > 1) {
    const pickedCandidates = await pickArchitectureCandidates(ctx, displayCandidates);
    if (pickedCandidates === undefined) {
      const action = await ctx.ui.select("Create RFC issues for which candidates?", [
        ...displayCandidates.map((candidate) => candidate.label),
        "All candidates",
        "Skip",
      ]);

      if (action === "Skip" || action == null) {
        return pipelineResult("Architecture review complete. No RFC created.", "architecture", stages);
      }

      if (action === "All candidates") {
        selectedCandidates = displayCandidates;
      } else {
        const selectedCandidate = displayCandidates.find((candidate) => candidate.label === action);
        selectedCandidates = selectedCandidate ? [selectedCandidate] : [{ label: "RFC", body: candidateContext }];
      }
    } else {
      if (pickedCandidates == null || pickedCandidates.length === 0) {
        return pipelineResult("Architecture review complete. No RFC created.", "architecture", stages);
      }
      selectedCandidates = pickedCandidates;
    }
  } else {
    const onlyCandidate = displayCandidates[0];
    const selectOptions = onlyCandidate ? [onlyCandidate.label, "Skip"] : ["Yes — generate RFC", "Skip"];

    const action = await ctx.ui.select("Create RFC issues for which candidates?", selectOptions);

    if (action === "Skip" || action == null) {
      return pipelineResult("Architecture review complete. No RFC created.", "architecture", stages);
    }

    if (action === "Yes — generate RFC") {
      selectedCandidates = [{ label: "RFC", body: candidateContext }];
    } else {
      const selectedCandidate = displayCandidates.find((candidate) => candidate.label === action);
      selectedCandidates = selectedCandidate ? [selectedCandidate] : [{ label: "RFC", body: candidateContext }];
    }
  }

  // Phase 2: Generate RFC and create GitHub issue for each selected candidate
  const createdIssues: string[] = [];

  for (const [i, candidate] of selectedCandidates.entries()) {
    const stageName = `architecture-rfc-${i + 1}`;
    stages.push(emptyStage(stageName));

    const rfcResult = await runAgentFn(
      "architecture-reviewer",
      `Based on the following architectural analysis, generate a detailed RFC and create a GitHub issue (with label "${ARCHITECTURE_LABEL}") for this specific candidate.\n\nCANDIDATE:\n${candidate.body}\n\nFULL ANALYSIS (for context):\n${candidateContext}`,
      { ...agentOpts, stageName },
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
