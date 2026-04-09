import { createForgeflowExtension, registerAtlassianCommands } from "@callumvass/forgeflow-shared/extension";
import {
  type ForgeflowContext,
  type OnUpdate,
  resolveAgentsDir,
  toPipelineContext,
} from "@callumvass/forgeflow-shared/pipeline";
import { commands } from "./commands.js";
import { runAtlassianRead } from "./pipelines/atlassian-read.js";
import { runContinue } from "./pipelines/continue.js";
import { runInit } from "./pipelines/init.js";
import { runInvestigate } from "./pipelines/investigate.js";
import { runCreateIssue, runCreateIssues } from "./pipelines/issue-creation/github.js";
import { runJiraIssues } from "./pipelines/issue-creation/jira.js";
import { runPrdQa } from "./pipelines/prd-qa.js";

const AGENTS_DIR = resolveAgentsDir(import.meta.url);

const pctx = (cwd: string, s: AbortSignal, u: OnUpdate, c: ForgeflowContext) =>
  toPipelineContext(cwd, s, u, c, AGENTS_DIR);

// `createForgeflowExtension` dedupes the `/stages` command and the
// Ctrl+Shift+S shortcut across forgeflow extensions via a process-wide
// registry, so this extension can coexist with `@callumvass/forgeflow-dev`
// in the same pi session without triggering a shortcut conflict.
const registerForgeflow = createForgeflowExtension({
  toolName: "forgeflow-pm",
  toolLabel: "Forgeflow PM",
  description: [
    "Run forgeflow PM pipelines: init (draft an initial PRD for greenfield projects),",
    "continue (update PRD Done/Next→QA→create issues for next phase),",
    "prd-qa (draft PRD if missing, then refine it), create-gh-issues (decompose PRD into GitHub issues),",
    "create-gh-issue (single issue from a feature idea),",
    "investigate (spike/RFC using codebase exploration + optional Confluence template),",
    "create-jira-issues (decompose Confluence PM docs into Jira issues),",
    "atlassian-read (read a Jira issue or Confluence page by URL).",
    "Each pipeline spawns specialized sub-agents with isolated context.",
  ].join(" "),
  params: {
    maxIterations: { type: "number", description: "Max iterations for prd-qa (default 10)" },
    issue: { type: "string", description: "Feature idea for create-gh-issue, description for continue/investigate" },
    url: { type: "string", description: "Atlassian URL for the atlassian-read pipeline" },
    template: { type: "string", description: "Confluence URL for a template (investigate)" },
    docs: { type: "string", description: "Comma-separated Confluence URLs for PM documents (jira-issues)" },
    example: { type: "string", description: "Confluence/Jira URL for an example ticket (jira-issues)" },
  },
  pipelines: [
    { name: "init", execute: (cwd, _p, s, u, c) => runInit(pctx(cwd, s, u, c)) },
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
    {
      name: "atlassian-read",
      execute: (cwd, p, s, u, c) => runAtlassianRead((p.url as string) ?? "", pctx(cwd, s, u, c)),
    },
  ],
  commands,
  renderCallExtra: (args, theme) => {
    let text = "";
    if (args.issue) text += theme.fg("dim", ` "${args.issue}"`);
    if (args.url) text += theme.fg("dim", ` ${args.url}`);
    if (args.maxIterations) text += theme.fg("muted", ` (max ${args.maxIterations})`);
    return text;
  },
});

export default (pi: Parameters<typeof registerForgeflow>[0]) => {
  registerForgeflow(pi);
  registerAtlassianCommands(pi, { toolName: "forgeflow-pm" });
};
