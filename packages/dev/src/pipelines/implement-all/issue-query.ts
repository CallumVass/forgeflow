import type { ExecFn } from "@callumvass/forgeflow-shared/pipeline";
import { IMPLEMENT_ALL_LABELS } from "./labels.js";

export interface IssueInfo {
  number: number;
  title: string;
  body: string;
}

/**
 * Fetch the set of already-closed issue numbers across every tracked label.
 * Used to seed the completed set so we don't re-pick historical work and so
 * dependency resolution sees prior completions.
 */
export async function fetchCompletedIssueNumbers(cwd: string, execFn: ExecFn): Promise<Set<number>> {
  const completed = new Set<number>();
  for (const label of IMPLEMENT_ALL_LABELS) {
    const closedJson = await execFn(
      `gh issue list --state closed --label "${label}" --json number --jq '.[].number'`,
      cwd,
    );
    if (!closedJson) continue;
    for (const n of closedJson.split("\n").filter(Boolean).map(Number)) {
      completed.add(n);
    }
  }
  return completed;
}

/**
 * Fetch open issues across every tracked label, deduped by number (so an issue
 * carrying both labels is picked up exactly once) and sorted ascending so
 * picks are deterministic.
 */
export async function fetchOpenIssues(cwd: string, execFn: ExecFn): Promise<IssueInfo[]> {
  const issuesByNumber = new Map<number, IssueInfo>();
  for (const label of IMPLEMENT_ALL_LABELS) {
    const issuesJson = await execFn(
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
  return [...issuesByNumber.values()].sort((a, b) => a.number - b.number);
}
