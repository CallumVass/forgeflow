import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { exec as defaultExec, type ExecFn } from "@callumvass/forgeflow-shared";

interface BranchSetupResult {
  status: "fresh" | "resumed" | "failed";
  ahead?: number;
  error?: string;
}

interface PrResult {
  number: number;
  created: boolean;
}

/**
 * Set up a feature branch. If the branch has commits ahead of main, resume it.
 * Otherwise, delete any stale branch and create fresh.
 */
export async function setupBranch(
  cwd: string,
  branch: string,
  execFn: ExecFn = defaultExec,
): Promise<BranchSetupResult> {
  // Check how many commits the branch is ahead of main
  const aheadStr = await execFn(`git rev-list main..${branch} --count 2>/dev/null || echo 0`, cwd);
  const ahead = parseInt(aheadStr, 10) || 0;

  if (ahead > 0) {
    // Resume existing branch with work
    await execFn(`git checkout ${branch}`, cwd);
    const current = await execFn("git branch --show-current", cwd);
    if (current !== branch) {
      return { status: "failed", error: `Failed to switch to ${branch} (on ${current})` };
    }
    return { status: "resumed", ahead };
  }

  // Delete stale local/remote branch and create fresh
  await execFn(`git branch -D ${branch} 2>/dev/null; git branch -dr origin/${branch} 2>/dev/null; echo done`, cwd);
  await execFn(`git checkout -b ${branch}`, cwd);

  // Verify we landed on the right branch — retry once
  let current = await execFn("git branch --show-current", cwd);
  if (current !== branch) {
    await execFn(`git checkout ${branch} 2>/dev/null || git checkout -b ${branch}`, cwd);
    current = await execFn("git branch --show-current", cwd);
  }

  if (current !== branch) {
    return { status: "failed", error: `Failed to switch to ${branch} (on ${current})` };
  }

  return { status: "fresh" };
}

/**
 * Ensure a PR exists for the given branch. Creates one if missing.
 */
export async function ensurePr(
  cwd: string,
  title: string,
  body: string,
  branch: string,
  execFn: ExecFn = defaultExec,
): Promise<PrResult> {
  // Push first
  await execFn(`git push -u origin ${branch}`, cwd);

  // Check for existing PR
  const existingNum = await findPrNumber(cwd, branch, execFn);
  if (existingNum != null) {
    return { number: existingNum, created: false };
  }

  // Create PR using temp file for body (avoids shell escaping issues)
  const tmp = path.join(os.tmpdir(), `forgeflow-pr-${Date.now()}.md`);
  try {
    fs.writeFileSync(tmp, body, "utf-8");
    const createOutput = await execFn(`gh pr create --title "${title}" --body-file "${tmp}" --head ${branch}`, cwd);

    // Extract PR number from URL in output (e.g. https://github.com/repo/pull/7)
    const urlMatch = createOutput.match(/\/pull\/(\d+)/);
    if (urlMatch?.[1]) {
      return { number: parseInt(urlMatch[1], 10), created: true };
    }

    // Fallback: list the PR we just created
    const createdNum = await findPrNumber(cwd, branch, execFn);
    return { number: createdNum ?? 0, created: true };
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {}
  }
}

/**
 * Find the PR number for a given branch. Returns null if no PR exists.
 */
export async function findPrNumber(cwd: string, branch: string, execFn: ExecFn = defaultExec): Promise<number | null> {
  const result = await execFn(`gh pr list --head "${branch}" --json number --jq '.[0].number'`, cwd);
  if (result && result !== "null") {
    return parseInt(result, 10);
  }
  return null;
}

/**
 * Squash-merge a PR and delete the branch. Verifies merge succeeded.
 */
export async function mergePr(cwd: string, prNumber: number, execFn: ExecFn = defaultExec): Promise<void> {
  const mergeResult = await execFn(`gh pr merge ${prNumber} --squash --delete-branch`, cwd);

  if (mergeResult.includes("Merged") || mergeResult.includes("merged")) {
    return;
  }

  // Fallback: check PR state directly
  const prState = await execFn(`gh pr view ${prNumber} --json state --jq '.state'`, cwd);

  if (prState === "MERGED") {
    return;
  }

  throw new Error(`Failed to merge PR #${prNumber}. State: ${prState || "unknown"}`);
}

/**
 * Return to main branch and pull latest.
 */
export async function returnToMain(cwd: string, execFn: ExecFn = defaultExec): Promise<void> {
  await execFn("git checkout main", cwd);
  await execFn("git pull --rebase", cwd);
}

/**
 * Verify the current branch matches the expected branch. Throws if not.
 */
export async function verifyOnBranch(cwd: string, expected: string, execFn: ExecFn = defaultExec): Promise<void> {
  const current = await execFn("git branch --show-current", cwd);
  if (current !== expected) {
    throw new Error(`Expected branch ${expected} but on ${current}`);
  }
}
