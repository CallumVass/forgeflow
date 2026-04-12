import type { ExecFn } from "@callumvass/forgeflow-shared/pipeline";
import { type ReviewTarget, readCurrentPrNumber } from "@callumvass/forgeflow-shared/repository";

/**
 * Resolve review policy from the target string.
 * - Numeric target → review a pull request
 * - `--branch <name>` → review a named branch
 * - Empty → review the current branch and attach the current PR number when available
 */
export async function resolveDiffTarget(cwd: string, target: string, execFn: ExecFn): Promise<ReviewTarget> {
  const trimmed = target.trim();

  if (trimmed.match(/^\d+$/)) {
    return { kind: "pr", prNumber: trimmed };
  }

  if (trimmed.startsWith("--branch")) {
    const branch = trimmed.replace("--branch", "").trim() || "HEAD";
    if (branch === "HEAD") {
      return { kind: "current" };
    }

    return { kind: "branch", branch };
  }

  return { kind: "current", prNumber: await readCurrentPrNumber({ cwd, execSafeFn: execFn }) };
}
