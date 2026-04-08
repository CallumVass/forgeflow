import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExecFn } from "@callumvass/forgeflow-shared/pipeline";

interface PrResult {
  number: number;
  created: boolean;
}

/**
 * Guard against a common failure mode: the implementor (or refactorer) agent
 * finishes without committing, leaving either a clean working tree or — more
 * commonly — tracked/untracked changes that were never `git add`ed. Without
 * this check `ensurePr` would push a zero-commit branch and then fail deep
 * inside `gh pr create` with an opaque "No commits between main and …" that
 * aborts the whole `implement-all` run.
 *
 * Throws a diagnostic Error listing any uncommitted/untracked paths so the
 * operator can see exactly what the agent abandoned.
 */
export async function assertBranchHasCommits(cwd: string, branch: string, execFn: ExecFn): Promise<void> {
  // `|| echo 0` mirrors setupBranch() — tolerates the rev-list failing when
  // main/branch refs are missing, falls back to 0 which then trips the guard.
  const aheadStr = await execFn(`git rev-list main..${branch} --count 2>/dev/null || echo 0`, cwd);
  const ahead = parseInt(aheadStr, 10) || 0;
  if (ahead > 0) return;

  let dirtyReport = "";
  try {
    const porcelain = (await execFn("git status --porcelain", cwd)).trim();
    if (porcelain) {
      dirtyReport = `\n\nUncommitted changes in the working tree:\n${porcelain}\n\nThe implementor agent likely forgot to 'git add' and 'git commit'. Review and commit manually, or delete the branch and re-run.`;
    } else {
      dirtyReport =
        "\n\nWorking tree is clean — the implementor agent produced no changes for this issue. Check the agent's output for why it bailed out.";
    }
  } catch {
    // Intentionally swallow — we still want to throw the primary guard error
    // even if `git status` itself failed.
  }

  throw new Error(`Branch ${branch} has 0 commits ahead of main — nothing to push.${dirtyReport}`);
}

/**
 * Ensure a PR exists for the given branch. Creates one if missing.
 */
export async function ensurePr(
  cwd: string,
  title: string,
  body: string,
  branch: string,
  execFn: ExecFn,
): Promise<PrResult> {
  // Fail fast if the agent never committed — pushing a zero-commit branch
  // would only surface as an opaque `gh pr create` error later.
  await assertBranchHasCommits(cwd, branch, execFn);

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
export async function findPrNumber(cwd: string, branch: string, execFn: ExecFn): Promise<number | null> {
  const result = await execFn(`gh pr list --head "${branch}" --json number --jq '.[0].number'`, cwd);
  if (result && result !== "null") {
    return parseInt(result, 10);
  }
  return null;
}

/**
 * Squash-merge a PR and delete the branch. Verifies merge succeeded.
 */
export async function mergePr(cwd: string, prNumber: number, execFn: ExecFn): Promise<void> {
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
export async function returnToMain(cwd: string, execFn: ExecFn): Promise<void> {
  await execFn("git checkout main", cwd);
  await execFn("git pull --rebase", cwd);
}
