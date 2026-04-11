import { extractFlags, splitFirstToken } from "@callumvass/forgeflow-shared/arg-parsing";
import type { CommandDefinition } from "@callumvass/forgeflow-shared/extension";

export const commands: CommandDefinition[] = [
  {
    name: "implement",
    description:
      "Implement a single issue using TDD. Usage: /implement <issue#|JIRA-KEY> [--skip-plan] [--skip-review]",
    pipeline: "implement",
    parseArgs: (args) => {
      const { flags, rest } = extractFlags(args, { boolean: ["--skip-plan", "--skip-review"] });
      const { first: issue } = splitFirstToken(rest);
      return {
        params: {
          ...(issue ? { issue } : {}),
          ...(flags["--skip-plan"] ? { skipPlan: true } : {}),
          ...(flags["--skip-review"] ? { skipReview: true } : {}),
        },
        suffix: issue
          ? "Do not interpret the issue number — pass it as-is."
          : "No issue number provided — the tool will detect it from the current branch. Do NOT ask for an issue number.",
      };
    },
  },
  {
    name: "implement-all",
    description:
      "Loop through all open auto-generated issues: implement, review, merge. Flags: --skip-plan, --skip-review",
    pipeline: "implement-all",
    parseArgs: (args) => {
      const { flags } = extractFlags(args, { boolean: ["--skip-plan", "--skip-review"] });
      return {
        params: {
          ...(flags["--skip-plan"] ? { skipPlan: true } : {}),
          ...(flags["--skip-review"] ? { skipReview: true } : {}),
        },
        suffix: "Do NOT ask for confirmation — run autonomously.",
      };
    },
  },
  {
    name: "review",
    description:
      "Run standalone review: blocking defects → judge, plus architecture/refactor advice. Usage: /review [target] [--strict]",
    pipeline: "review",
    parseArgs: (args) => {
      const { flags, rest } = extractFlags(args, { boolean: ["--strict"], value: ["--branch"] });
      const branch = flags["--branch"] as string | undefined;
      if (branch) {
        return {
          params: { target: `--branch ${branch}`, ...(flags["--strict"] ? { strict: true } : {}) },
          suffix: "Do not interpret the target — pass it as-is.",
        };
      }
      const { first: target } = splitFirstToken(rest);
      return {
        params: { ...(target ? { target } : {}), ...(flags["--strict"] ? { strict: true } : {}) },
        suffix: "Do not interpret the target — pass it as-is.",
      };
    },
  },
  {
    name: "review-lite",
    description: "Run strict review only: blocking defects → judge. Usage: /review-lite [target]",
    pipeline: "review",
    parseArgs: (args) => {
      const { flags, rest } = extractFlags(args, { value: ["--branch"] });
      const branch = flags["--branch"] as string | undefined;
      if (branch) {
        return {
          params: { target: `--branch ${branch}`, strict: true },
          suffix: "Do not interpret the target — pass it as-is.",
        };
      }
      const { first: target } = splitFirstToken(rest);
      return {
        params: { ...(target ? { target } : {}), strict: true },
        suffix: "Do not interpret the target — pass it as-is.",
      };
    },
  },
  {
    name: "architecture",
    description: "Analyze codebase for architectural friction and create RFC issues",
    pipeline: "architecture",
  },
  {
    name: "discover-skills",
    description: "Find and install domain-specific plugins from skills.sh for this project's tech stack",
    pipeline: "discover-skills",
    parseArgs: (args) => {
      const query = args.trim();
      return {
        params: query ? { issue: query } : {},
        suffix: "Present the tool's output verbatim — do not summarize or reformat it.",
      };
    },
  },
];
