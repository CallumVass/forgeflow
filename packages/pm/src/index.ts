import { resolveAgentsDir } from "@callumvass/forgeflow-shared/constants";
import { type ForgeflowContext, toPipelineContext } from "@callumvass/forgeflow-shared/context";
import { createForgeflowExtension } from "@callumvass/forgeflow-shared/extension";
import type { OnUpdate } from "@callumvass/forgeflow-shared/stage";
import { commands } from "./commands.js";
import { runContinue } from "./pipelines/continue.js";
import { runCreateIssue, runCreateIssues } from "./pipelines/create-issues.js";
import { runInvestigate } from "./pipelines/investigate.js";
import { runJiraIssues } from "./pipelines/jira-issues.js";
import { runPrdQa } from "./pipelines/prd-qa.js";

const AGENTS_DIR = resolveAgentsDir(import.meta.url);

const pctx = (cwd: string, s: AbortSignal, u: OnUpdate, c: ForgeflowContext) =>
  toPipelineContext(cwd, s, u, c, AGENTS_DIR);

export default createForgeflowExtension({
  toolName: "forgeflow-pm",
  toolLabel: "Forgeflow PM",
  description: [
    "Run forgeflow PM pipelines: continue (update PRD Done/Next→QA→create issues for next phase),",
    "prd-qa (refine PRD), create-gh-issues (decompose PRD into GitHub issues),",
    "create-gh-issue (single issue from a feature idea),",
    "investigate (spike/RFC using codebase exploration + optional Confluence template),",
    "create-jira-issues (decompose Confluence PM docs into Jira issues).",
    "Each pipeline spawns specialized sub-agents with isolated context.",
  ].join(" "),
  params: {
    maxIterations: { type: "number", description: "Max iterations for prd-qa (default 10)" },
    issue: { type: "string", description: "Feature idea for create-gh-issue, description for continue/investigate" },
    template: { type: "string", description: "Confluence URL for a template (investigate)" },
    docs: { type: "string", description: "Comma-separated Confluence URLs for PM documents (jira-issues)" },
    example: { type: "string", description: "Confluence/Jira URL for an example ticket (jira-issues)" },
  },
  pipelines: [
    {
      name: "continue",
      execute: (cwd, p, s, u, c) =>
        runContinue((p.issue as string) ?? "", (p.maxIterations as number) ?? 10, pctx(cwd, s, u, c)),
    },
    { name: "prd-qa", execute: (cwd, p, s, u, c) => runPrdQa((p.maxIterations as number) ?? 10, pctx(cwd, s, u, c)) },
    { name: "create-gh-issues", execute: (cwd, _p, s, u, c) => runCreateIssues(pctx(cwd, s, u, c)) },
    {
      name: "create-gh-issue",
      execute: (cwd, p, s, u, c) => runCreateIssue((p.issue as string) ?? "", pctx(cwd, s, u, c)),
    },
    {
      name: "investigate",
      execute: (cwd, p, s, u, c) =>
        runInvestigate((p.issue as string) ?? "", (p.template as string) ?? "", pctx(cwd, s, u, c)),
    },
    {
      name: "create-jira-issues",
      execute: (cwd, p, s, u, c) => {
        const docUrls = ((p.docs as string) ?? "")
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean);
        return runJiraIssues(docUrls, (p.example as string) ?? "", pctx(cwd, s, u, c));
      },
    },
  ],
  commands,
  renderCallExtra: (args, theme) => {
    let text = "";
    if (args.issue) text += theme.fg("dim", ` "${args.issue}"`);
    if (args.maxIterations) text += theme.fg("muted", ` (max ${args.maxIterations})`);
    return text;
  },
});
