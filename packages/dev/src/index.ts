import { resolveAgentsDir } from "@callumvass/forgeflow-shared/constants";
import { type ForgeflowContext, toPipelineContext } from "@callumvass/forgeflow-shared/context";
import { createForgeflowExtension } from "@callumvass/forgeflow-shared/extension";
import type { OnUpdate } from "@callumvass/forgeflow-shared/stage";
import { commands } from "./commands.js";
import { runArchitecture } from "./pipelines/architecture.js";
import { runDiscoverSkills } from "./pipelines/discover-skills.js";
import { runImplement } from "./pipelines/implement.js";
import { runImplementAll } from "./pipelines/implement-all.js";
import { runReview } from "./pipelines/review.js";

const AGENTS_DIR = resolveAgentsDir(import.meta.url);

const pctx = (cwd: string, s: AbortSignal, u: OnUpdate, c: ForgeflowContext) =>
  toPipelineContext(cwd, s, u, c, AGENTS_DIR);

export default createForgeflowExtension({
  toolName: "forgeflow-dev",
  toolLabel: "Forgeflow Dev",
  description: [
    "Run forgeflow dev pipelines: implement (plan→TDD→refactor a single issue),",
    "implement-all (loop through all open issues autonomously), review (deterministic checks→code review→judge),",
    "architecture (analyze codebase for structural friction→create RFC issues),",
    "discover-skills (find and install domain-specific plugins).",
    "Each pipeline spawns specialized sub-agents with isolated context.",
  ].join(" "),
  params: {
    issue: { type: "string", description: "Issue number or description for implement pipeline" },
    target: { type: "string", description: "PR number or --branch for review pipeline" },
    skipPlan: { type: "boolean", description: "Skip planner, implement directly (default false)" },
    skipReview: { type: "boolean", description: "Skip code review after implementation (default false)" },
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
      execute: (cwd, p, s, u, c) => runReview((p.target as string) ?? "", pctx(cwd, s, u, c)),
    },
    { name: "architecture", execute: (cwd, _p, s, u, c) => runArchitecture(pctx(cwd, s, u, c)) },
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
    if (args.target) text += theme.fg("dim", ` ${args.target}`);
    return text;
  },
});
