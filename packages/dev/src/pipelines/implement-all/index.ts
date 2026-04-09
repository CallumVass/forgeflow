import {
  emptyStage,
  type PipelineContext,
  pipelineResult,
  type StageResult,
  sumUsage,
  withRunLifecycle,
} from "@callumvass/forgeflow-shared/pipeline";
import { findPrNumber, mergePr, returnToMain } from "../../git/pr-lifecycle.js";
import { setForgeflowStatus, updateProgressWidget } from "../../ui/index.js";
import { runImplement } from "../implement/index.js";
import { waitForChecksAndFix } from "./ci-wait.js";
import { getReadyIssues } from "./dependency-resolution.js";
import { fetchCompletedIssueNumbers, fetchOpenIssues } from "./issue-query.js";
import { ARCHITECTURE_LABEL, IMPLEMENT_ALL_LABELS } from "./labels.js";

export { ARCHITECTURE_LABEL, getReadyIssues, IMPLEMENT_ALL_LABELS };

type IssueStatus = "pending" | "running" | "done" | "failed";

function countDone(progress: Map<number, { status: IssueStatus }>): number {
  return [...progress.values()].filter((v) => v.status === "done").length;
}

export async function runImplementAll(pctx: PipelineContext, flags: { skipPlan: boolean; skipReview: boolean }) {
  return withRunLifecycle(pctx, "implement-all", (innerPctx) => runImplementAllInner(innerPctx, flags));
}

async function runImplementAllInner(pctx: PipelineContext, flags: { skipPlan: boolean; skipReview: boolean }) {
  const { cwd, signal, ctx, execFn } = pctx;
  const allStages: StageResult[] = [];
  const issueProgress = new Map<number, { title: string; status: IssueStatus }>();

  // Seed completed set with already-closed issues across every tracked label.
  const completed = await fetchCompletedIssueNumbers(cwd, execFn);

  let iteration = 0;
  const maxIterations = 50;

  while (iteration++ < maxIterations) {
    if (signal.aborted) break;

    // Return to main and pull
    await returnToMain(cwd, execFn);

    // Fetch open issues for every tracked label, deduped + sorted ascending.
    const issues = await fetchOpenIssues(cwd, execFn);

    if (issues.length === 0) {
      return pipelineResult("All issues implemented.", "implement-all", allStages);
    }

    // Track all known issues in progress widget
    for (const issue of issues) {
      if (!issueProgress.has(issue.number)) {
        issueProgress.set(issue.number, { title: issue.title, status: "pending" });
      }
    }

    // Find ready issues (deps satisfied)
    const ready = getReadyIssues(issues, completed);
    if (ready.length === 0) {
      return pipelineResult(
        `${issues.length} issues remain but all have unresolved dependencies.`,
        "implement-all",
        allStages,
        true,
      );
    }

    // biome-ignore lint/style/noNonNullAssertion: ready is non-empty (checked above)
    const issueNum = ready[0]!;
    const issueTitle = issues.find((i) => i.number === issueNum)?.title ?? `#${issueNum}`;

    // Update status + widget
    issueProgress.set(issueNum, { title: issueTitle, status: "running" });
    setForgeflowStatus(
      ctx,
      `implement-all · ${countDone(issueProgress)}/${issueProgress.size} · #${issueNum} ${issueTitle}`,
    );
    updateProgressWidget(ctx, issueProgress, sumUsage(allStages).cost);

    // Run implement for this issue
    allStages.push(emptyStage(`implement-${issueNum}`));
    const implResult = await runImplement(String(issueNum), pctx, {
      ...flags,
      autonomous: true,
    });

    // Accumulate usage from detailed stages into the container stage
    const implStage = allStages.find((s) => s.name === `implement-${issueNum}`);
    if (implStage) {
      implStage.status = implResult.isError ? "failed" : "done";
      implStage.output = implResult.content[0]?.type === "text" ? implResult.content[0].text : "";
      const detailedStages = implResult.details?.stages;
      if (detailedStages) implStage.usage = sumUsage(detailedStages);
    }

    if (implResult.isError) {
      issueProgress.set(issueNum, { title: issueTitle, status: "failed" });
      updateProgressWidget(ctx, issueProgress, sumUsage(allStages).cost);
      return pipelineResult(
        `Failed on issue #${issueNum}: ${implResult.content[0]?.type === "text" ? implResult.content[0].text : "unknown error"}`,
        "implement-all",
        allStages,
        true,
      );
    }

    // --- CI wait-and-fix loop ---
    //
    // runImplement ends on the feature branch. Stay here until CI has
    // a verdict so any fix cycles that `waitForChecksAndFix` triggers
    // can push to the branch without needing a checkout dance. Only
    // return to main once the PR is either merged or declared failed.
    const branch = `feat/issue-${issueNum}`;
    const prNum = await findPrNumber(cwd, branch, execFn);

    if (prNum == null) {
      await returnToMain(cwd, execFn);
      issueProgress.set(issueNum, { title: issueTitle, status: "failed" });
      updateProgressWidget(ctx, issueProgress, sumUsage(allStages).cost);
      return pipelineResult(
        `No PR found for issue #${issueNum} after implementation.`,
        "implement-all",
        allStages,
        true,
      );
    }

    // Block on CI; fix failures autonomously up to the attempt cap.
    const ciResult = await waitForChecksAndFix(pctx, prNum, branch, allStages);
    if (!ciResult.passed) {
      await returnToMain(cwd, execFn);
      issueProgress.set(issueNum, { title: issueTitle, status: "failed" });
      updateProgressWidget(ctx, issueProgress, sumUsage(allStages).cost);
      const checks = ciResult.failedChecks.length > 0 ? ciResult.failedChecks.join(", ") : "unknown";
      return pipelineResult(
        `CI failed for PR #${prNum} (${ciResult.reason ?? "unknown"}): ${checks} after ${ciResult.attempts} fix attempt(s).`,
        "implement-all",
        allStages,
        true,
      );
    }

    await returnToMain(cwd, execFn);

    try {
      await mergePr(cwd, prNum, execFn);
      completed.add(issueNum);
    } catch {
      issueProgress.set(issueNum, { title: issueTitle, status: "failed" });
      updateProgressWidget(ctx, issueProgress, sumUsage(allStages).cost);
      return pipelineResult(`Failed to merge PR #${prNum} for issue #${issueNum}.`, "implement-all", allStages, true);
    }

    // Mark done and update widget
    issueProgress.set(issueNum, { title: issueTitle, status: "done" });
    setForgeflowStatus(
      ctx,
      `implement-all · ${countDone(issueProgress)}/${issueProgress.size} · $${sumUsage(allStages).cost.toFixed(2)}`,
    );
    updateProgressWidget(ctx, issueProgress, sumUsage(allStages).cost);
  }

  return pipelineResult(`Reached max iterations (${maxIterations}).`, "implement-all", allStages);
}
