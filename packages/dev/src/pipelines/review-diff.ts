import { execSafe as defaultExecSafe, type ExecFn } from "@callumvass/forgeflow-shared";

interface DiffTarget {
  diffCmd: string;
  prNumber?: string;
}

/**
 * Resolve what to diff based on the target string.
 * - Numeric target → `gh pr diff <n>` with PR number
 * - `--branch <name>` → `git diff main...<name>`
 * - Empty → `git diff main...HEAD`, auto-detect PR from current branch
 */
export async function resolveDiffTarget(
  cwd: string,
  target: string,
  execFn: ExecFn = defaultExecSafe,
): Promise<DiffTarget> {
  if (target.match(/^\d+$/)) {
    return { diffCmd: `gh pr diff ${target}`, prNumber: target };
  }

  if (target.startsWith("--branch")) {
    const branch = target.replace("--branch", "").trim() || "HEAD";
    return { diffCmd: `git diff main...${branch}` };
  }

  // Default: diff against main, try to auto-detect PR number
  let prNumber: string | undefined;
  const pr = await execFn("gh pr view --json number --jq .number", cwd);
  if (pr && pr !== "") {
    prNumber = pr;
  }

  return { diffCmd: "git diff main...HEAD", prNumber };
}
