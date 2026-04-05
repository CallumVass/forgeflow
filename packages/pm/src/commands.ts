import { type CommandDefinition, extractFlags, unquote } from "@callumvass/forgeflow-shared";

export const commands: CommandDefinition[] = [
  {
    name: "continue",
    description:
      'Update PRD with Done/Next based on codebase state, QA the Next section, then create issues. Usage: /continue ["description of next phase"]',
    pipeline: "continue",
    parseArgs: (args) => {
      const trimmed = unquote(args.trim());
      return { params: trimmed ? { issue: trimmed } : {}, suffix: "Do not interpret the description — pass it as-is." };
    },
  },
  {
    name: "prd-qa",
    description: "Refine PRD.md via critic → architect → integrator loop",
    pipeline: "prd-qa",
    parseArgs: (args) => ({ params: { maxIterations: parseInt(args, 10) || 10 } }),
  },
  {
    name: "create-gh-issues",
    description: "Decompose PRD.md into vertical-slice GitHub issues",
    pipeline: "create-gh-issues",
  },
  {
    name: "create-gh-issue",
    description: "Create a single GitHub issue from a feature idea",
    pipeline: "create-gh-issue",
    parseArgs: (args) => {
      const issue = args.trim();
      return { params: issue ? { issue } : {}, suffix: "Do not interpret the issue text — pass it as-is." };
    },
  },
  {
    name: "investigate",
    description:
      "Spike or RFC: explore codebase + web, fill a Confluence template. Usage: /investigate [description] [--template <confluence-url>]",
    pipeline: "investigate",
    parseArgs: (args) => {
      const { flags, rest } = extractFlags(args, { value: ["--template"] });
      const description = unquote(rest);
      return {
        params: {
          ...(description ? { issue: description } : {}),
          ...(flags["--template"] ? { template: flags["--template"] as string } : {}),
        },
        suffix: "Do not interpret the description — pass it as-is.",
      };
    },
  },
  {
    name: "create-jira-issues",
    description:
      "Decompose Confluence PM docs into Jira issues. Usage: /create-jira-issues [confluence-url] [confluence-url...] [--example <confluence-url>]",
    pipeline: "create-jira-issues",
    parseArgs: (args) => {
      const { flags, rest } = extractFlags(args, { value: ["--example"] });
      const docs = rest.split(/\s+/).filter(Boolean);
      return {
        params: {
          ...(docs.length > 0 ? { docs: docs.join(",") } : {}),
          ...(flags["--example"] ? { example: flags["--example"] as string } : {}),
        },
        suffix: "Do not interpret the URLs — pass them as-is.",
      };
    },
  },
];
