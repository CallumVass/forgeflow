import { type CommandDefinition, extractFlags, splitFirstToken, unquote } from "@callumvass/forgeflow-shared";

export const commands: CommandDefinition[] = [
  {
    name: "implement",
    description:
      "Implement a single issue using TDD. Usage: /implement <issue#|JIRA-KEY> [custom prompt] [--skip-plan] [--skip-review]",
    pipeline: "implement",
    parseArgs: (args) => {
      const { flags, rest } = extractFlags(args, { boolean: ["--skip-plan", "--skip-review"] });
      const { first: issue, rest: prompt } = splitFirstToken(rest);
      const customPrompt = unquote(prompt);
      return {
        params: {
          ...(issue ? { issue } : {}),
          ...(customPrompt ? { customPrompt } : {}),
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
    description: "Run code review: deterministic checks → reviewer → judge. Usage: /review [target] [custom prompt]",
    pipeline: "review",
    parseArgs: (args) => {
      const { flags, rest } = extractFlags(args, { value: ["--branch"] });
      const branch = flags["--branch"] as string | undefined;
      if (branch) {
        const customPrompt = unquote(rest);
        return {
          params: { target: `--branch ${branch}`, ...(customPrompt ? { customPrompt } : {}) },
          suffix: "Do not interpret the target — pass it as-is.",
        };
      }
      const { first: target, rest: prompt } = splitFirstToken(rest);
      const customPrompt = unquote(prompt);
      return {
        params: { ...(target ? { target } : {}), ...(customPrompt ? { customPrompt } : {}) },
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
