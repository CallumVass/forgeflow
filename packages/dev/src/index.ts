import { createForgeflowExtension, registerAtlassianCommands } from "@callumvass/forgeflow-shared/extension";
import {
  type ForgeflowContext,
  type OnUpdate,
  resolveAgentsDir,
  toPipelineContext,
} from "@callumvass/forgeflow-shared/pipeline";
import { commands } from "./commands.js";
import { registerDatadogCommands } from "./datadog/commands.js";
import { runArchitecture } from "./pipelines/architecture/index.js";
import { runAtlassianRead } from "./pipelines/atlassian-read.js";
import { runDatadog } from "./pipelines/datadog/index.js";
import { runDiscoverSkills } from "./pipelines/discover-skills.js";
import { runImplement } from "./pipelines/implement/index.js";
import { runImplementAll } from "./pipelines/implement-all/index.js";
import { runReview } from "./pipelines/review/index.js";

const AGENTS_DIR = resolveAgentsDir(import.meta.url);

const pctx = (cwd: string, s: AbortSignal, u: OnUpdate, c: ForgeflowContext) =>
  toPipelineContext(cwd, s, u, c, AGENTS_DIR);

// `createForgeflowExtension` dedupes the `/stages` command and the
// Ctrl+Shift+S shortcut across forgeflow extensions via a process-wide
// registry, so this extension can coexist with `@callumvass/forgeflow-pm`
// in the same pi session without triggering a shortcut conflict.
const registerForgeflow = createForgeflowExtension({
  toolName: "forgeflow-dev",
  toolLabel: "Forgeflow Dev",
  description: [
    "Run forgeflow dev pipelines: implement (plan→TDD→refactor a single issue),",
    "implement-all (loop through all open issues autonomously), review (blocking review→judge plus standalone architecture/refactor advice),",
    "review-lite (strict blocking review→judge only),",
    "architecture (analyze codebase for structural friction→create RFC issues),",
    "atlassian-read (read a Jira issue or Confluence page by URL),",
    "datadog (resolve repo Lambdas then investigate Datadog runtime questions through MCP),",
    "discover-skills (find and install domain-specific plugins).",
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
  },
  pipelines: [
    {
      name: "implement",
      execute: (cwd, p, s, u, c) =>
        runImplement((p.issue as string) ?? "", pctx(cwd, s, u, c), {
          skipPlan: (p.skipPlan as boolean) ?? false,
          skipReview: (p.skipReview as boolean) ?? false,
        }),
    },
    {
      name: "implement-all",
      execute: (cwd, p, s, u, c) =>
        runImplementAll(pctx(cwd, s, u, c), {
          skipPlan: (p.skipPlan as boolean) ?? false,
          skipReview: (p.skipReview as boolean) ?? false,
        }),
    },
    {
      name: "review",
      execute: (cwd, p, s, u, c) =>
        runReview((p.target as string) ?? "", pctx(cwd, s, u, c), { strict: (p.strict as boolean) ?? false }),
    },
    { name: "architecture", execute: (cwd, _p, s, u, c) => runArchitecture(pctx(cwd, s, u, c)) },
    {
      name: "atlassian-read",
      execute: (cwd, p, s, u, c) => runAtlassianRead((p.url as string) ?? "", pctx(cwd, s, u, c)),
    },
    {
      name: "datadog",
      execute: (cwd, p, s, u, c) => runDatadog((p.prompt as string) ?? "", pctx(cwd, s, u, c)),
    },
    {
      name: "discover-skills",
      execute: (cwd, p, s, u, c) => runDiscoverSkills((p.issue as string) ?? "", pctx(cwd, s, u, c)),
    },
  ],
  commands,
  renderCallExtra: (args, theme) => {
    let text = "";
    if (args.issue) {
      const prefix = /^[A-Z]+-\d+$/.test(args.issue as string) ? " " : " #";
      text += theme.fg("dim", `${prefix}${args.issue}`);
    }
    if (args.prompt) text += theme.fg("dim", ` "${args.prompt}"`);
    if (args.url) text += theme.fg("dim", ` ${args.url}`);
    if (args.target) text += theme.fg("dim", ` ${args.target}`);
    if (args.strict) text += theme.fg("dim", " --strict");
    return text;
  },
});

export default (pi: Parameters<typeof registerForgeflow>[0]) => {
  registerForgeflow(pi);
  registerAtlassianCommands(pi, { toolName: "forgeflow-dev" });
  registerDatadogCommands(pi);
};
