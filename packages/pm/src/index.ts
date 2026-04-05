import { type PipelineDetails, renderResult } from "@callumvass/forgeflow-shared";
import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { runContinue } from "./pipelines/continue.js";
import { runCreateIssue, runCreateIssues } from "./pipelines/create-issues.js";
import { runInvestigate } from "./pipelines/investigate.js";
import { runJiraIssues } from "./pipelines/jira-issues.js";
import { runPrdQa } from "./pipelines/prd-qa.js";

interface ForgeflowPmInput {
  pipeline: string;
  maxIterations?: number;
  issue?: string;
  template?: string;
  docs?: string;
  example?: string;
}

// ─── Tool registration ────────────────────────────────────────────────

const ForgeflowPmParams = Type.Object({
  pipeline: Type.String({
    description:
      'Which pipeline to run: "continue", "prd-qa", "create-gh-issues", "create-gh-issue", "investigate", or "create-jira-issues"',
  }),
  maxIterations: Type.Optional(Type.Number({ description: "Max iterations for prd-qa (default 10)" })),
  issue: Type.Optional(
    Type.String({ description: "Feature idea for create-gh-issue, description for continue/investigate" }),
  ),
  template: Type.Optional(Type.String({ description: "Confluence URL for a template (investigate)" })),
  docs: Type.Optional(Type.String({ description: "Comma-separated Confluence URLs for PM documents (jira-issues)" })),
  example: Type.Optional(Type.String({ description: "Confluence/Jira URL for an example ticket (jira-issues)" })),
});

function registerForgeflowPmTool(pi: ExtensionAPI) {
  pi.registerTool({
    name: "forgeflow-pm",
    label: "Forgeflow PM",
    description: [
      "Run forgeflow PM pipelines: continue (update PRD Done/Next→QA→create issues for next phase),",
      "prd-qa (refine PRD), create-gh-issues (decompose PRD into GitHub issues),",
      "create-gh-issue (single issue from a feature idea),",
      "investigate (spike/RFC using codebase exploration + optional Confluence template),",
      "create-jira-issues (decompose Confluence PM docs into Jira issues).",
      "Each pipeline spawns specialized sub-agents with isolated context.",
    ].join(" "),
    parameters: ForgeflowPmParams,

    async execute(_toolCallId, _params, signal, onUpdate, ctx) {
      const params = _params as ForgeflowPmInput;
      const cwd = ctx.cwd as string;
      const sig = signal ?? new AbortController().signal;

      try {
        switch (params.pipeline) {
          case "continue":
            return await runContinue(cwd, params.issue ?? "", params.maxIterations ?? 10, sig, onUpdate, ctx);
          case "prd-qa":
            return await runPrdQa(cwd, params.maxIterations ?? 10, sig, onUpdate, ctx);
          case "create-gh-issues":
            return await runCreateIssues(cwd, sig, onUpdate, ctx);
          case "create-gh-issue":
            return await runCreateIssue(cwd, params.issue ?? "", sig, onUpdate, ctx);
          case "investigate":
            return await runInvestigate(cwd, params.issue ?? "", params.template ?? "", sig, onUpdate, ctx);
          case "create-jira-issues": {
            const docUrls = (params.docs ?? "")
              .split(",")
              .map((u) => u.trim())
              .filter(Boolean);
            return await runJiraIssues(cwd, docUrls, params.example ?? "", sig, onUpdate, ctx);
          }
          default:
            return {
              content: [
                {
                  type: "text",
                  text: `Unknown pipeline: ${params.pipeline}. Use: continue, prd-qa, create-gh-issues, create-gh-issue, investigate, create-jira-issues`,
                },
              ],
              details: { pipeline: params.pipeline, stages: [] } as PipelineDetails,
            };
        }
      } finally {
        if (ctx.hasUI) {
          ctx.ui.setStatus("forgeflow-pm", undefined);
          ctx.ui.setWidget("forgeflow-pm", undefined);
        }
      }
    },

    renderCall(_args, theme) {
      const args = _args as ForgeflowPmInput;
      const pipeline = args.pipeline || "?";
      let text = theme.fg("toolTitle", theme.bold("forgeflow-pm ")) + theme.fg("accent", pipeline);
      if (args.issue) text += theme.fg("dim", ` "${args.issue}"`);
      if (args.maxIterations) text += theme.fg("muted", ` (max ${args.maxIterations})`);
      return new Text(text, 0, 0);
    },

    renderResult(result, { expanded }, theme) {
      return renderResult(result as AgentToolResult<PipelineDetails>, expanded, theme, "forgeflow-pm");
    },
  });
}

// ─── Command arg parsers ──────────────────────────────────────────────

function parseInvestigateArgs(args: string): { description: string; template: string } {
  const templateMatch = args.match(/--template\s+(\S+)/);
  const template = templateMatch ? (templateMatch[1] ?? "") : "";
  const description = args
    .replace(/--template\s+\S+/, "")
    .trim()
    .replace(/^"(.*)"$/, "$1");
  return { description, template };
}

function parseJiraIssuesArgs(args: string): { docs: string[]; example: string } {
  const exampleMatch = args.match(/--example\s+(\S+)/);
  const example = exampleMatch ? (exampleMatch[1] ?? "") : "";
  const rest = args.replace(/--example\s+\S+/, "").trim();
  const docs = rest.split(/\s+/).filter(Boolean);
  return { docs, example };
}

// ─── Extension entry point ────────────────────────────────────────────

const extension: (pi: ExtensionAPI) => void = (pi) => {
  registerForgeflowPmTool(pi);

  pi.registerCommand("continue", {
    description:
      'Update PRD with Done/Next based on codebase state, QA the Next section, then create issues. Usage: /continue ["description of next phase"]',
    handler: async (args) => {
      const trimmed = args.trim().replace(/^"(.*)"$/, "$1");
      const descPart = trimmed ? `, issue="${trimmed}"` : "";
      pi.sendUserMessage(
        `Call the forgeflow-pm tool now with these exact parameters: pipeline="continue"${descPart}. Do not interpret the description — pass it as-is.`,
      );
    },
  });

  pi.registerCommand("prd-qa", {
    description: "Refine PRD.md via critic → architect → integrator loop",
    handler: async (args) => {
      const maxIter = parseInt(args, 10) || 10;
      pi.sendUserMessage(
        `Call the forgeflow-pm tool now with these exact parameters: pipeline="prd-qa", maxIterations=${maxIter}.`,
      );
    },
  });

  pi.registerCommand("create-gh-issues", {
    description: "Decompose PRD.md into vertical-slice GitHub issues",
    handler: async () => {
      pi.sendUserMessage(`Call the forgeflow-pm tool now with these exact parameters: pipeline="create-gh-issues".`);
    },
  });

  pi.registerCommand("create-gh-issue", {
    description: "Create a single GitHub issue from a feature idea",
    handler: async (args) => {
      const issuePart = args.trim() ? `, issue="${args.trim()}"` : "";
      pi.sendUserMessage(
        `Call the forgeflow-pm tool now with these exact parameters: pipeline="create-gh-issue"${issuePart}. Do not interpret the issue text — pass it as-is.`,
      );
    },
  });

  pi.registerCommand("investigate", {
    description:
      "Spike or RFC: explore codebase + web, fill a Confluence template. Usage: /investigate [description] [--template <confluence-url>]",
    handler: async (args) => {
      const { description, template } = parseInvestigateArgs(args);
      const issuePart = description ? `, issue="${description}"` : "";
      const templatePart = template ? `, template="${template}"` : "";
      pi.sendUserMessage(
        `Call the forgeflow-pm tool now with these exact parameters: pipeline="investigate"${issuePart}${templatePart}. Do not interpret the description — pass it as-is.`,
      );
    },
  });

  pi.registerCommand("create-jira-issues", {
    description:
      "Decompose Confluence PM docs into Jira issues. Usage: /create-jira-issues [confluence-url] [confluence-url...] [--example <confluence-url>]",
    handler: async (args) => {
      const { docs, example } = parseJiraIssuesArgs(args);
      const docsPart = docs.length > 0 ? `, docs="${docs.join(",")}"` : "";
      const examplePart = example ? `, example="${example}"` : "";
      pi.sendUserMessage(
        `Call the forgeflow-pm tool now with these exact parameters: pipeline="create-jira-issues"${docsPart}${examplePart}. Do not interpret the URLs — pass them as-is.`,
      );
    },
  });
};

export default extension;
