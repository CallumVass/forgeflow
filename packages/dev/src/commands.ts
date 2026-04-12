import { extractFlags, splitFirstToken } from "@callumvass/forgeflow-shared/arg-parsing";
import type { CommandDefinition } from "@callumvass/forgeflow-shared/extension";
import { getRememberedInvocation, withLaunchers } from "./command-launchers/index.js";

const baseCommands: CommandDefinition[] = [
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
    name: "implement-last",
    description: "Repeat the last /implement target and flags, or fall back to current-branch detection",
    pipeline: "implement",
    parseArgs: () => {
      const last = getRememberedInvocation("implement-last");
      return {
        params: {
          ...(last?.issue ? { issue: last.issue } : {}),
          ...(last?.skipPlan ? { skipPlan: true } : {}),
          ...(last?.skipReview ? { skipReview: true } : {}),
        },
        suffix: last?.issue
          ? /^[A-Z]+-\d+$/.test(last.issue)
            ? "Do not interpret the issue key — pass it as-is."
            : /^\d+$/.test(last.issue)
              ? "Do not interpret the issue number — pass it as-is."
              : undefined
          : "No remembered issue number found — the tool will detect it from the current branch. Do NOT ask for an issue number.",
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
    name: "review-last",
    description: "Repeat the last /review target and strictness, or fall back to the current branch",
    pipeline: "review",
    parseArgs: () => {
      const last = getRememberedInvocation("review-last");
      return {
        params: {
          ...(last?.target ? { target: last.target } : {}),
          ...(last?.strict ? { strict: true } : {}),
        },
        suffix: "Do not interpret the target — pass it as-is.",
      };
    },
  },
  {
    name: "review-current-pr",
    description: "Review the current PR without typing its number",
    pipeline: "review",
    parseArgs: () => ({ params: {}, suffix: "Review the current PR if one exists. Do not ask for a target first." }),
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
      "Scan common skill locations and show which skills forgeflow would use at each stage. Usage: /skill-scan [--command <implement|review|architecture|...>] [--path <path>] [--issue <text>] [--target <review-target>] [--verbose] [--json]",
    pipeline: "skill-scan",
    parseArgs: (args) => {
      const { flags } = extractFlags(args, {
        boolean: ["--json", "--verbose"],
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
          ...(flags["--verbose"] ? { verbose: true } : {}),
        },
        suffix: "Do not interpret the command, path, issue text, or target — pass them as-is.",
      };
    },
  },
  {
    name: "skill-recommend",
    description:
      "Recommend missing skills from skills.sh for the current repo and stage. Usage: /skill-recommend [--for <implement|review|architecture|...>] [--path <path>] [--issue <text>] [--target <review-target>] [--limit <n>] [--verbose] [--json]",
    pipeline: "skill-recommend",
    parseArgs: (args) => {
      const { flags } = extractFlags(args, {
        boolean: ["--json", "--verbose"],
        value: ["--for", "--command", "--path", "--issue", "--target", "--branch", "--limit"],
      });
      const command = (flags["--for"] as string | undefined) ?? (flags["--command"] as string | undefined);
      const limitRaw = flags["--limit"] as string | undefined;
      const limit = limitRaw ? Number(limitRaw) : undefined;
      return {
        params: {
          ...(command ? { command } : {}),
          ...(flags["--path"] ? { path: flags["--path"] as string } : {}),
          ...(flags["--issue"] ? { issue: flags["--issue"] as string } : {}),
          ...(flags["--branch"] ? { target: `--branch ${flags["--branch"] as string}` } : {}),
          ...(flags["--target"] ? { target: flags["--target"] as string } : {}),
          ...(limit !== undefined ? { limit } : {}),
          ...(flags["--json"] ? { json: true } : {}),
          ...(flags["--verbose"] ? { verbose: true } : {}),
        },
        suffix: "Do not interpret the command, path, issue text, target, or limit — pass them as-is.",
      };
    },
  },
];

export const commands: CommandDefinition[] = withLaunchers(baseCommands);
