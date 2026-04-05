import { type PipelineDetails, renderResult } from "@callumvass/forgeflow-shared";
import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { runArchitecture } from "./pipelines/architecture.js";
import { runDiscoverSkills } from "./pipelines/discover-skills.js";
import { runImplement } from "./pipelines/implement.js";
import { runImplementAll } from "./pipelines/implement-all.js";
import { runReview } from "./pipelines/review.js";

interface ForgeflowDevInput {
  pipeline: string;
  issue?: string;
  target?: string;
  skipPlan?: boolean;
  skipReview?: boolean;
  customPrompt?: string;
}

function parseImplFlags(args: string) {
  const skipPlan = args.includes("--skip-plan");
  const skipReview = args.includes("--skip-review");
  const rest = args
    .replace(/--skip-plan/g, "")
    .replace(/--skip-review/g, "")
    .trim();

  const firstSpace = rest.indexOf(" ");
  const issue = firstSpace === -1 ? rest : rest.slice(0, firstSpace);
  const customPrompt =
    firstSpace === -1
      ? ""
      : rest
          .slice(firstSpace + 1)
          .trim()
          .replace(/^"(.*)"$/, "$1");

  const flags = [skipPlan ? ", skipPlan: true" : "", skipReview ? ", skipReview: true" : ""].join("");
  return { issue, customPrompt, flags };
}

function parseReviewArgs(args: string) {
  const trimmed = args.trim();
  if (!trimmed) return { target: "", customPrompt: "" };

  if (trimmed.startsWith("--branch")) {
    const afterFlag = trimmed.replace(/^--branch\s*/, "").trim();
    const firstSpace = afterFlag.indexOf(" ");
    if (firstSpace === -1) return { target: `--branch ${afterFlag}`, customPrompt: "" };
    return {
      target: `--branch ${afterFlag.slice(0, firstSpace)}`,
      customPrompt: afterFlag
        .slice(firstSpace + 1)
        .trim()
        .replace(/^"(.*)"$/, "$1"),
    };
  }

  const firstSpace = trimmed.indexOf(" ");
  if (firstSpace === -1) return { target: trimmed, customPrompt: "" };
  return {
    target: trimmed.slice(0, firstSpace),
    customPrompt: trimmed
      .slice(firstSpace + 1)
      .trim()
      .replace(/^"(.*)"$/, "$1"),
  };
}

// ─── Tool registration ────────────────────────────────────────────────

const ForgeflowDevParams = Type.Object({
  pipeline: Type.String({
    description: 'Which pipeline to run: "implement", "implement-all", "review", "architecture", or "discover-skills"',
  }),
  issue: Type.Optional(
    Type.String({
      description: "Issue number or description for implement pipeline",
    }),
  ),
  target: Type.Optional(Type.String({ description: "PR number or --branch for review pipeline" })),
  skipPlan: Type.Optional(Type.Boolean({ description: "Skip planner, implement directly (default false)" })),
  skipReview: Type.Optional(Type.Boolean({ description: "Skip code review after implementation (default false)" })),
  customPrompt: Type.Optional(
    Type.String({ description: "Additional user instructions passed to agents (e.g. 'check the openapi spec')" }),
  ),
});

function registerForgeflowDevTool(pi: ExtensionAPI) {
  pi.registerTool({
    name: "forgeflow-dev",
    label: "Forgeflow Dev",
    description: [
      "Run forgeflow dev pipelines: implement (plan→TDD→refactor a single issue),",
      "implement-all (loop through all open issues autonomously), review (deterministic checks→code review→judge),",
      "architecture (analyze codebase for structural friction→create RFC issues),",
      "discover-skills (find and install domain-specific plugins).",
      "Each pipeline spawns specialized sub-agents with isolated context.",
    ].join(" "),
    parameters: ForgeflowDevParams,

    async execute(_toolCallId, _params, signal, onUpdate, ctx) {
      const params = _params as ForgeflowDevInput;
      const cwd = ctx.cwd as string;
      const sig = signal ?? new AbortController().signal;

      try {
        switch (params.pipeline) {
          case "implement":
            return await runImplement(cwd, params.issue ?? "", sig, onUpdate, ctx, {
              skipPlan: params.skipPlan ?? false,
              skipReview: params.skipReview ?? false,
              customPrompt: params.customPrompt,
            });
          case "implement-all":
            return await runImplementAll(cwd, sig, onUpdate, ctx, {
              skipPlan: params.skipPlan ?? false,
              skipReview: params.skipReview ?? false,
            });
          case "review":
            return await runReview(cwd, params.target ?? "", sig, onUpdate, ctx, params.customPrompt);
          case "architecture":
            return await runArchitecture(cwd, sig, onUpdate, ctx);
          case "discover-skills":
            return await runDiscoverSkills(cwd, params.issue ?? "", sig, onUpdate, ctx);
          default:
            return {
              content: [
                {
                  type: "text",
                  text: `Unknown pipeline: ${params.pipeline}. Use: implement, implement-all, review, architecture, discover-skills`,
                },
              ],
              details: { pipeline: params.pipeline, stages: [] } as PipelineDetails,
            };
        }
      } finally {
        if (ctx.hasUI) {
          ctx.ui.setStatus("forgeflow-dev", undefined);
          ctx.ui.setWidget("forgeflow-dev", undefined);
        }
      }
    },

    renderCall(_args, theme) {
      const args = _args as ForgeflowDevInput;
      const pipeline = args.pipeline || "?";
      let text = theme.fg("toolTitle", theme.bold("forgeflow-dev ")) + theme.fg("accent", pipeline);
      if (args.issue) {
        const prefix = /^[A-Z]+-\d+$/.test(args.issue) ? " " : " #";
        text += theme.fg("dim", `${prefix}${args.issue}`);
      }
      if (args.target) text += theme.fg("dim", ` ${args.target}`);
      return new Text(text, 0, 0);
    },

    renderResult(result, { expanded }, theme) {
      return renderResult(result as AgentToolResult<PipelineDetails>, expanded, theme, "forgeflow-dev");
    },
  });
}

// ─── Extension entry point ────────────────────────────────────────────

const extension: (pi: ExtensionAPI) => void = (pi) => {
  registerForgeflowDevTool(pi);

  pi.registerCommand("implement", {
    description:
      "Implement a single issue using TDD. Usage: /implement <issue#|JIRA-KEY> [custom prompt] [--skip-plan] [--skip-review]",
    handler: async (args) => {
      const { issue, customPrompt, flags } = parseImplFlags(args);
      const promptPart = customPrompt ? `, customPrompt: "${customPrompt}"` : "";

      if (issue) {
        pi.sendUserMessage(
          `Call the forgeflow-dev tool now with these exact parameters: pipeline="implement", issue="${issue}"${promptPart}${flags}. Do not interpret the issue number — pass it as-is.`,
        );
      } else {
        pi.sendUserMessage(
          `Call the forgeflow-dev tool now with these exact parameters: pipeline="implement"${promptPart}${flags}. No issue number provided — the tool will detect it from the current branch. Do NOT ask for an issue number.`,
        );
      }
    },
  });

  pi.registerCommand("implement-all", {
    description:
      "Loop through all open auto-generated issues: implement, review, merge. Flags: --skip-plan, --skip-review",
    handler: async (args) => {
      const { flags } = parseImplFlags(args);

      pi.sendUserMessage(
        `Call the forgeflow-dev tool now with these exact parameters: pipeline="implement-all"${flags}. Do NOT ask for confirmation — run autonomously.`,
      );
    },
  });

  pi.registerCommand("review", {
    description: "Run code review: deterministic checks → reviewer → judge. Usage: /review [target] [custom prompt]",
    handler: async (args) => {
      const { target, customPrompt } = parseReviewArgs(args);
      const promptPart = customPrompt ? `, customPrompt: "${customPrompt}"` : "";
      pi.sendUserMessage(
        `Call the forgeflow-dev tool now with these exact parameters: pipeline="review"${target ? `, target="${target}"` : ""}${promptPart}. Do not interpret the target — pass it as-is.`,
      );
    },
  });

  pi.registerCommand("architecture", {
    description: "Analyze codebase for architectural friction and create RFC issues",
    handler: async () => {
      pi.sendUserMessage(`Call the forgeflow-dev tool now with these exact parameters: pipeline="architecture".`);
    },
  });

  pi.registerCommand("discover-skills", {
    description: "Find and install domain-specific plugins from skills.sh for this project's tech stack",
    handler: async (args) => {
      const query = args.trim();
      if (query) {
        pi.sendUserMessage(
          `Call the forgeflow-dev tool now with these exact parameters: pipeline="discover-skills", issue="${query}". Present the tool's output verbatim — do not summarize or reformat it.`,
        );
      } else {
        pi.sendUserMessage(
          `Call the forgeflow-dev tool now with these exact parameters: pipeline="discover-skills". Present the tool's output verbatim — do not summarize or reformat it.`,
        );
      }
    },
  });
};

export default extension;
