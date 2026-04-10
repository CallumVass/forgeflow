import { emitUpdate, emptyStage, type PipelineContext, type StageResult } from "@callumvass/forgeflow-shared/pipeline";
import { buildPrBody, ensurePr, mergePr, returnToMain } from "../../git/index.js";
import type { ResolvedIssue } from "../../issues/index.js";

interface FinalisePrOptions {
  autonomous: boolean;
  stages: StageResult[];
}

interface FinalisePrResult {
  prNumber: number;
  merged: boolean;
}

/**
 * Finalise a completed implementation run: push the branch, create (or look
 * up) a PR, and — when not running autonomously — merge the PR and return
 * to main. Mutates `opts.stages` by appending a `merge` stage when a merge
 * actually runs, and notifies progress via `pctx.onUpdate`.
 *
 * Short-circuits when `resolved.branch` is empty (e.g. free-text issues
 * that never checked out a feature branch).
 */
export async function finalisePr(
  resolved: ResolvedIssue,
  pctx: PipelineContext,
  opts: FinalisePrOptions,
): Promise<FinalisePrResult> {
  if (!resolved.branch) return { prNumber: 0, merged: false };

  const { cwd, execFn, onUpdate } = pctx;
  const prResult = await ensurePr(cwd, resolved.title, buildPrBody(cwd, resolved), resolved.branch, execFn);
  const prNumber = prResult.number;

  if (opts.autonomous || prNumber <= 0) {
    return { prNumber, merged: false };
  }

  const mergeStage = emptyStage("merge");
  opts.stages.push(mergeStage);
  await mergePr(cwd, prNumber, execFn);
  await returnToMain(cwd, execFn);
  mergeStage.status = "done";
  mergeStage.output = `Merged PR #${prNumber}`;
  emitUpdate({ stages: opts.stages, pipeline: "implement", onUpdate });

  return { prNumber, merged: true };
}
