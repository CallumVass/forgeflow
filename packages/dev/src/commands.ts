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
    name: "skill-scan",
    description:
      "Scan common skill locations, inspect repo signals, and explain which skills forgeflow would recommend. Usage: /skill-scan [--command <implement|review|architecture|...>] [--path <path>] [--issue <text>] [--target <review-target>] [--json]",
    pipeline: "skill-scan",
    parseArgs: (args) => {
      const { flags } = extractFlags(args, {
        boolean: ["--json"],
        value: ["--command", "--path", "--issue", "--target", "--branch"],
      });
      return {
        params: {
          ...(flags["--command"] ? { command: flags["--command"] as string } : {}),
          ...(flags["--path"] ? { path: flags["--path"] as string } : {}),
          ...(flags["--issue"] ? { issue: flags["--issue"] as string } : {}),
          ...(flags["--branch"] ? { target: `--branch ${flags["--branch"] as string}` } : {}),
          ...(flags["--target"] ? { target: flags["--target"] as string } : {}),
          ...(flags["--json"] ? { json: true } : {}),
        },
        suffix: "Do not interpret the command, path, issue text, or target — pass them as-is.",
      };
    },
  },
];
