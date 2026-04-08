import { exec } from "@callumvass/forgeflow-shared/exec";
import {
  emptyStage,
  type PipelineContext,
  pipelineResult,
  type StageResult,
  sumUsage,
} from "@callumvass/forgeflow-shared/pipeline";
import { findPrNumber, mergePr, returnToMain } from "../utils/git-workflow.js";
import { setForgeflowStatus, updateProgressWidget } from "../utils/ui.js";
import { runImplement } from "./implement.js";

/**
 * Labels that `/implement-all` picks up. Must stay in sync with the label the
 * architecture pipeline applies when creating RFC issues.
 */
export const IMPLEMENT_ALL_LABELS = ["auto-generated", "architecture"] as const;

interface IssueInfo {
  number: number;
  title: string;
  body: string;
}

type IssueStatus = "pending" | "running" | "done" | "failed";

function countDone(progress: Map<number, { status: IssueStatus }>): number {
  return [...progress.values()].filter((v) => v.status === "done").length;
}

/**
 * Get issue numbers whose dependencies (referenced as #N in ## Dependencies section) are satisfied.
 */
export function getReadyIssues(issues: IssueInfo[], completed: Set<number>): number[] {
  return issues
    .filter((issue) => {
      if (completed.has(issue.number)) return false;
      const parts = issue.body.split("## Dependencies");
      if (parts.length < 2) return true;
      const depSection = parts[1]?.split("\n## ")[0] ?? "";
      const deps = [...depSection.matchAll(/#(\d+)/g)].map((m) => parseInt(m[1] ?? "0", 10));
      return deps.every((d) => completed.has(d));
    })
    .map((i) => i.number);
}

export async function runImplementAll(pctx: PipelineContext, flags: { skipPlan: boolean; skipReview: boolean }) {
  const { cwd, signal, ctx } = pctx;
  const allStages: StageResult[] = [];
  const issueProgress = new Map<number, { title: string; status: IssueStatus }>();

  // Seed completed set with already-closed issues across every tracked label.
  const completed = new Set<number>();
  for (const label of IMPLEMENT_ALL_LABELS) {
    const closedJson = await exec(
      `gh issue list --state closed --label "${label}" --json number --jq '.[].number'`,
      cwd,
    );
    if (!closedJson) continue;
    for (const n of closedJson.split("\n").filter(Boolean).map(Number)) {
      completed.add(n);
    }
  }

  let iteration = 0;
  const maxIterations = 50;

  while (iteration++ < maxIterations) {
    if (signal.aborted) break;

    // Return to main and pull
    await returnToMain(cwd, exec);

    // Fetch open issues for every tracked label and merge+dedupe by number.
    const issuesByNumber = new Map<number, IssueInfo>();
    for (const label of IMPLEMENT_ALL_LABELS) {
      const issuesJson = await exec(
        `gh issue list --state open --label "${label}" --json number,title,body --jq 'sort_by(.number)'`,
        cwd,
      );
      let parsed: IssueInfo[];
      try {
        parsed = JSON.parse(issuesJson || "[]");
      } catch {
        parsed = [];
      }
      for (const issue of parsed) {
        if (!issuesByNumber.has(issue.number)) {
          issuesByNumber.set(issue.number, issue);
        }
      }
    }
    const issues: IssueInfo[] = [...issuesByNumber.values()].sort((a, b) => a.number - b.number);

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

    // Merge PR and return to main
    const branch = `feat/issue-${issueNum}`;
    await returnToMain(cwd, exec);

    const prNum = await findPrNumber(cwd, branch, exec);

    if (prNum != null) {
      try {
        await mergePr(cwd, prNum, exec);
        completed.add(issueNum);
      } catch {
        issueProgress.set(issueNum, { title: issueTitle, status: "failed" });
        updateProgressWidget(ctx, issueProgress, sumUsage(allStages).cost);
        return pipelineResult(`Failed to merge PR #${prNum} for issue #${issueNum}.`, "implement-all", allStages, true);
      }
    } else {
      issueProgress.set(issueNum, { title: issueTitle, status: "failed" });
      updateProgressWidget(ctx, issueProgress, sumUsage(allStages).cost);
      return pipelineResult(
        `No PR found for issue #${issueNum} after implementation.`,
        "implement-all",
        allStages,
        true,
      );
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
