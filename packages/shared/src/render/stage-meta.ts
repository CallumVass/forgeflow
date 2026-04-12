const STAGE_META: Record<string, { title: string; description: string }> = {
  planner: {
    title: "Plan implementation",
    description: "Writing the test-first plan and sequencing the work.",
  },
  "architecture-reviewer": {
    title: "Review plan boundaries",
    description: "Checking the plan against existing boundaries and reusable patterns.",
  },
  implementor: {
    title: "Implement changes",
    description: "Writing the code and tests for the planned behaviour.",
  },
  refactorer: {
    title: "Refactor safely",
    description: "Tidying the implementation once the tests pass.",
  },
  "code-reviewer": {
    title: "Review for blocking defects",
    description: "Looking for concrete, user-facing defects in the diff.",
  },
  "review-judge": {
    title: "Validate findings",
    description: "Verifying which review findings survive against the actual code.",
  },
  "fix-findings": {
    title: "Fix validated findings",
    description: "Applying only the validated review fixes.",
  },
  "architecture-delta-reviewer": {
    title: "Review architectural deltas",
    description: "Checking whether the diff worsened architectural boundaries.",
  },
  "refactor-reviewer": {
    title: "Suggest follow-up refactors",
    description: "Looking for non-blocking cleanup worth doing next.",
  },
  "propose-comments": {
    title: "Draft PR comments",
    description: "Preparing ready-to-post GitHub review comments.",
  },
  merge: {
    title: "Merge pull request",
    description: "Squash-merging the branch and returning to main.",
  },
};

function fallbackTitle(stageName: string): string {
  return stageName
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function stageTitle(stageName: string): string {
  if (/^implement-\d+$/.test(stageName)) return `Implement issue ${stageName.replace("implement-", "#")}`;
  return STAGE_META[stageName]?.title ?? fallbackTitle(stageName);
}

export function stageDescription(stageName: string): string | undefined {
  if (/^implement-\d+$/.test(stageName)) {
    return "Running the full autonomous implement pipeline for this issue.";
  }
  return STAGE_META[stageName]?.description;
}
