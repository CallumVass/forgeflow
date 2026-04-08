import type { PipelineContext, StageResult } from "@callumvass/forgeflow-shared/pipeline";
import { fetchFailedCiLogs, waitForChecks } from "../utils/pr-lifecycle.js";
import { runChain } from "./chain.js";

interface CiWaitResult {
  /** All check runs eventually passed (or were skipped). Safe to merge. */
  passed: boolean;
  /**
   * Number of fix cycles that ran. `0` when the first wait already
   * passed. Capped at `maxAttempts`.
   */
  attempts: number;
  /**
   * Failed check names from the last wait. Empty when `passed` is
   * `true`. Populated on failure so the caller can surface a
   * meaningful diagnostic.
   */
  failedChecks: string[];
  /**
   * Reason for giving up when `passed` is `false`. One of:
   * - `"ci-failed-after-max-attempts"`: the loop hit `maxAttempts` and
   *   the latest wait still had failing checks.
   * - `"no-logs"`: we could not fetch CI logs for the failed run, so
   *   there is nothing to hand to the fix agent.
   * - `"unknown-bucket"`: the JSON rollup was empty or unparseable,
   *   which usually indicates a gh error rather than a real failure.
   */
  reason?: "ci-failed-after-max-attempts" | "no-logs" | "unknown-bucket";
}

const DEFAULT_MAX_ATTEMPTS = 3;

/**
 * Wait for CI on `prNumber` to finish. On success, return. On failure,
 * fetch the failed-run logs, spawn the implementor agent to fix the
 * failures, wait for CI again, and repeat up to `maxAttempts` times.
 *
 * Runs entirely through `pctx.runAgentFn` / `pctx.execSafeFn` so it
 * slots into the existing `run-dir` lifecycle: the fix agent is a
 * single-phase chain invocation that allocates its own session file
 * under the active run directory. It does not fork from any prior
 * session — the fix task is self-contained, starting from the CI logs
 * and a fresh read of the branch state.
 *
 * The loop is deliberately simple: no exponential backoff between
 * attempts because `gh pr checks --watch` already blocks on GitHub's
 * own polling, and no partial-progress metric because GitHub reports
 * check state atomically once a run terminates. If the fix agent
 * pushes a commit, the next wait picks up the new run; if it pushes
 * nothing, the wait returns immediately with the same failures.
 */
export async function waitForChecksAndFix(
  pctx: PipelineContext,
  prNumber: number,
  branch: string,
  stages: StageResult[],
  maxAttempts: number = DEFAULT_MAX_ATTEMPTS,
): Promise<CiWaitResult> {
  let attempts = 0;

  for (;;) {
    const waitResult = await waitForChecks(pctx.cwd, prNumber, pctx.execSafeFn);
    if (waitResult.passed) {
      return { passed: true, attempts, failedChecks: [] };
    }

    // Guard against gh returning an empty / unparseable rollup — we
    // cannot ask the fix agent to fix failures it cannot see, so
    // return early with the ambiguity flagged.
    if (waitResult.failedChecks.length === 0) {
      return {
        passed: false,
        attempts,
        failedChecks: [],
        reason: "unknown-bucket",
      };
    }

    if (attempts >= maxAttempts) {
      return {
        passed: false,
        attempts,
        failedChecks: waitResult.failedChecks,
        reason: "ci-failed-after-max-attempts",
      };
    }

    const logs = await fetchFailedCiLogs(pctx.cwd, branch, pctx.execSafeFn);
    if (!logs) {
      return {
        passed: false,
        attempts,
        failedChecks: waitResult.failedChecks,
        reason: "no-logs",
      };
    }

    attempts += 1;

    // Spawn the implementor as a single-phase chain. No forkFrom: the
    // fix task stands on its own, starting from a fresh read of the
    // branch tip. The chain-builder allocates a session file under the
    // run-dir (when persistence is on) and names it after the stage.
    const failedNames = waitResult.failedChecks.join(", ");
    const task = [
      `The CI check(s) on PR #${prNumber} are failing: ${failedNames}.`,
      "",
      `You are on branch ${branch}. Read the failed-job logs below, locate the cause in the code, fix it, run the full check suite locally to confirm, commit with a conventional 'fix: ...' message, and push.`,
      "",
      "CI failed logs:",
      "",
      logs,
      "",
      "RULES:",
      "- Fix only what the CI is flagging. Do not refactor unrelated code.",
      "- Do NOT skip or disable the failing test/check.",
      "- If the failure is environmental (flake, infra) rather than a code bug, write BLOCKED.md with a short diagnosis and stop.",
    ].join("\n");

    await runChain(
      [
        {
          agent: "implementor",
          stageName: `ci-fix-${attempts}`,
          buildTask: () => task,
        },
      ],
      pctx,
      { pipeline: "implement-all", stages },
    );

    // Loop back: wait for the new CI run triggered by the push.
  }
}
