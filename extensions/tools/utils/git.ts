import { exec } from "./exec.js";

export interface ResolvedIssue {
  number: number;
  title: string;
  body: string;
  branch: string;
  existingPR?: number;
}

/**
 * Checkout a branch, creating it if it doesn't exist.
 */
export async function ensureBranch(cwd: string, branch: string): Promise<void> {
  const currentBranch = await exec("git branch --show-current", cwd);
  if (currentBranch === branch) return;
  const exists = await exec(`git rev-parse --verify ${branch} 2>/dev/null && echo yes || echo no`, cwd);
  if (exists === "yes") {
    await exec(`git checkout ${branch}`, cwd);
  } else {
    await exec(`git checkout -b ${branch}`, cwd);
  }
}

/**
 * Resolve which issue to implement:
 * 1. Explicit issue number provided → fetch it
 * 2. On a feature branch (feat/issue-N) → extract N
 * 3. On main → pick next open auto-generated issue
 *
 * Also checks for existing branch/PR.
 */
export async function resolveIssue(cwd: string, issueArg?: string): Promise<ResolvedIssue | string> {
  let issueNum: number;

  if (issueArg && /^\d+$/.test(issueArg)) {
    issueNum = parseInt(issueArg, 10);
  } else if (issueArg) {
    return { number: 0, title: issueArg, body: issueArg, branch: "" };
  } else {
    const branch = await exec("git branch --show-current", cwd);
    const match = branch.match(/(?:feat\/)?issue-(\d+)/);

    if (match) {
      // biome-ignore lint/style/noNonNullAssertion: match[1] guaranteed by regex
      issueNum = parseInt(match[1]!, 10);
    } else {
      return `On branch "${branch}" — can't detect issue number. Use /implement <issue#>.`;
    }
  }

  const issueJson = await exec(`gh issue view ${issueNum} --json number,title,body`, cwd);
  if (!issueJson) return `Could not fetch issue #${issueNum}.`;

  let issue: { number: number; title: string; body: string };
  try {
    issue = JSON.parse(issueJson);
  } catch {
    return `Could not parse issue #${issueNum}.`;
  }

  const branch = `feat/issue-${issueNum}`;
  const prJson = await exec(`gh pr list --head "${branch}" --json number --jq '.[0].number'`, cwd);
  const existingPR = prJson && prJson !== "null" ? parseInt(prJson, 10) : undefined;

  return { ...issue, branch, existingPR };
}
