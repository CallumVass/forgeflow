import { createForgeflowPackageExtension } from "@callumvass/forgeflow-shared/extension";
import { rememberCommandInvocation } from "../command-launchers/index.js";
import { commands } from "../commands.js";
import { registerDatadogCommands } from "../datadog/commands.js";
import { runArchitecture } from "../pipelines/architecture/index.js";
import { runAtlassianRead } from "../pipelines/atlassian-read.js";
import { runDatadog } from "../pipelines/datadog/index.js";
import { runImplement } from "../pipelines/implement/index.js";
import { runImplementAll } from "../pipelines/implement-all/index.js";
import { runReview } from "../pipelines/review/index.js";
import { handleDevResult } from "../result-actions/index.js";
import { runSkillRecommend, runSkillScan } from "../skills/index.js";
import { restoreDevSessionState } from "./session-start.js";

export default function createDevExtension(moduleUrl: string) {
  return createForgeflowPackageExtension({
    moduleUrl,
    toolName: "forgeflow-dev",
    toolLabel: "Forgeflow Dev",
    description: [
      "Run forgeflow dev pipelines: implement (plan→TDD→refactor a single issue),",
      "implement-all (loop through all open issues autonomously), review (blocking review→judge plus standalone architecture/refactor advice),",
      "review-lite (strict blocking review→judge only),",
      "architecture (analyze codebase for structural friction→create RFC issues),",
      "skill-scan (scan common skill locations and explain repo-aware recommendations),",
      "skill-recommend (query skills.sh for missing repo-relevant skills to install),",
      "atlassian-read (read a Jira issue or Confluence page by URL),",
      "datadog (resolve repo Lambdas then investigate Datadog runtime questions through MCP).",
      "Each pipeline spawns specialized sub-agents with isolated context.",
    ].join(" "),
    params: {
      issue: { type: "string", description: "Issue number or description for implement pipeline" },
      prompt: { type: "string", description: "Freeform Datadog investigation prompt" },
      url: { type: "string", description: "Atlassian URL for the atlassian-read pipeline" },
      target: { type: "string", description: "PR number or --branch for review pipeline" },
      skipPlan: { type: "boolean", description: "Skip planner, implement directly (default false)" },
      skipReview: { type: "boolean", description: "Skip code review after implementation (default false)" },
      strict: { type: "boolean", description: "Use strict review mode without advisory architecture/refactor passes" },
      command: {
        type: "string",
        description: "Target command to analyse for the skill-scan / skill-recommend pipelines",
      },
      path: { type: "string", description: "Focus path for the skill-scan / skill-recommend pipelines" },
      json: {
        type: "boolean",
        description: "Emit machine-readable JSON from the skill-scan / skill-recommend pipelines",
      },
      limit: { type: "number", description: "Maximum remote skills to return for the skill-recommend pipeline" },
    },
    pipelines: [
      {
        name: "implement",
        run: (params, pctx) =>
          runImplement((params.issue as string) ?? "", pctx, {
            skipPlan: (params.skipPlan as boolean) ?? false,
            skipReview: (params.skipReview as boolean) ?? false,
          }),
      },
      {
        name: "implement-all",
        run: (params, pctx) =>
          runImplementAll(pctx, {
            skipPlan: (params.skipPlan as boolean) ?? false,
            skipReview: (params.skipReview as boolean) ?? false,
          }),
      },
      {
        name: "review",
        run: (params, pctx) =>
          runReview((params.target as string) ?? "", pctx, { strict: (params.strict as boolean) ?? false }),
      },
      { name: "architecture", run: (_params, pctx) => runArchitecture(pctx) },
      {
        name: "skill-scan",
        run: (params, pctx) =>
          runSkillScan(
            {
              command: params.command as string | undefined,
              path: params.path as string | undefined,
              issue: params.issue as string | undefined,
              target: params.target as string | undefined,
              json: (params.json as boolean) ?? false,
            },
            pctx,
          ),
      },
      {
        name: "skill-recommend",
        run: (params, pctx) =>
          runSkillRecommend(
            {
              command: params.command as string | undefined,
              path: params.path as string | undefined,
              issue: params.issue as string | undefined,
              target: params.target as string | undefined,
              json: (params.json as boolean) ?? false,
              limit: typeof params.limit === "number" ? params.limit : undefined,
            },
            pctx,
          ),
      },
      { name: "atlassian-read", run: (params, pctx) => runAtlassianRead((params.url as string) ?? "", pctx) },
      { name: "datadog", run: (params, pctx) => runDatadog((params.prompt as string) ?? "", pctx) },
    ],
    commands,
    onCommandInvoked: rememberCommandInvocation,
    onResult: handleDevResult,
    registerExtraCommands: registerDatadogCommands,
    onSessionStart: restoreDevSessionState,
    renderCallExtra: (args, theme) => {
      let text = "";
      if (args.issue) {
        const prefix = /^[A-Z]+-\d+$/.test(args.issue as string) ? " " : " #";
        text += theme.fg("dim", `${prefix}${args.issue}`);
      }
      if (args.prompt) text += theme.fg("dim", ` "${args.prompt}"`);
      if (args.url) text += theme.fg("dim", ` ${args.url}`);
      if (args.target) text += theme.fg("dim", ` ${args.target}`);
      if (args.command) text += theme.fg("dim", ` --command ${args.command}`);
      if (args.path) text += theme.fg("dim", ` --path ${args.path}`);
      if (args.json) text += theme.fg("dim", " --json");
      if (args.limit !== undefined) text += theme.fg("dim", ` --limit ${args.limit}`);
      if (args.strict) text += theme.fg("dim", " --strict");
      return text;
    },
  });
}
