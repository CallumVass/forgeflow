import type { ExecFn } from "@callumvass/forgeflow-shared/pipeline";

interface BranchSetupResult {
  status: "fresh" | "resumed" | "failed";
  ahead?: number;
  error?: string;
}

/**
 * Set up a feature branch. If the branch has commits ahead of main, resume it.
 * Otherwise, delete any stale branch and create fresh.
 */
export async function setupBranch(cwd: string, branch: string, execFn: ExecFn): Promise<BranchSetupResult> {
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
