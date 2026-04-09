import type { ExecFn } from "@callumvass/forgeflow-shared/pipeline";

interface DiffTarget {
  diffCmd: string;
  prNumber?: string;
  setupCmds: string[];
}

/**
 * Resolve what to diff based on the target string.
 * - Numeric target → check out the PR branch, then `gh pr diff <n>`
 * - `--branch <name>` → check out that branch, then `git diff main...HEAD`
 * - Empty → `git diff main...HEAD`, auto-detect PR from current branch
 */
export async function resolveDiffTarget(cwd: string, target: string, execFn: ExecFn): Promise<DiffTarget> {
  const trimmed = target.trim();

  if (trimmed.match(/^\d+$/)) {
    return {
      diffCmd: `gh pr diff ${trimmed}`,
      prNumber: trimmed,
      setupCmds: [`gh pr checkout ${trimmed}`],
    };
  }

  if (trimmed.startsWith("--branch")) {
    const branch = trimmed.replace("--branch", "").trim() || "HEAD";
    if (branch === "HEAD") {
      return { diffCmd: "git diff main...HEAD", setupCmds: [] };
    }

    const quotedBranch = JSON.stringify(branch);
    const quotedRemoteBranch = JSON.stringify(`origin/${branch}`);

    return {
      diffCmd: "git diff main...HEAD",
      setupCmds: [
        `git fetch origin ${quotedBranch} 2>/dev/null || true`,
        `git checkout ${quotedBranch} 2>/dev/null || git checkout -b ${quotedBranch} --track ${quotedRemoteBranch}`,
      ],
    };
  }

  // Default: diff against main, try to auto-detect PR number
  let prNumber: string | undefined;
  const pr = await execFn("gh pr view --json number --jq .number", cwd);
  if (pr && pr !== "") {
    prNumber = pr;
  }

  return { diffCmd: "git diff main...HEAD", prNumber, setupCmds: [] };
}
