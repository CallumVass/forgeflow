import { createForgeflowPackageExtension } from "@callumvass/forgeflow-shared/extension";
import { commands } from "../commands.js";
import { runAtlassianRead } from "../pipelines/atlassian-read.js";
import { runContinue } from "../pipelines/continue.js";
import { runInit } from "../pipelines/init.js";
import { runInvestigate } from "../pipelines/investigate.js";
import { runCreateIssue, runCreateIssues } from "../pipelines/issue-creation/github.js";
import { runJiraIssues } from "../pipelines/issue-creation/jira.js";
import { runPrdQa } from "../pipelines/prd-qa.js";

export default function createPmExtension(moduleUrl: string) {
  return createForgeflowPackageExtension({
    moduleUrl,
    toolName: "forgeflow-pm",
    toolLabel: "Forgeflow PM",
    description: [
      "Run forgeflow PM pipelines: init (draft an initial PRD plus bootstrap constraints for greenfield projects),",
      "continue (update PRD Done/Next→QA→create issues for next phase),",
      "prd-qa (draft PRD if missing, then refine it and prompt for one final review), create-gh-issues (decompose PRD into GitHub issues),",
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
      { name: "init", run: (_params, pctx) => runInit(pctx) },
      {
        name: "continue",
        run: (params, pctx) =>
          runContinue((params.issue as string) ?? "", (params.maxIterations as number) ?? 10, pctx),
      },
      { name: "prd-qa", run: (params, pctx) => runPrdQa((params.maxIterations as number) ?? 10, pctx) },
      { name: "create-gh-issues", run: (_params, pctx) => runCreateIssues(pctx) },
      { name: "create-gh-issue", run: (params, pctx) => runCreateIssue((params.issue as string) ?? "", pctx) },
      {
        name: "investigate",
        run: (params, pctx) => runInvestigate((params.issue as string) ?? "", (params.template as string) ?? "", pctx),
      },
      {
        name: "create-jira-issues",
        run: (params, pctx) => {
          const docUrls = ((params.docs as string) ?? "")
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean);
          return runJiraIssues(docUrls, (params.example as string) ?? "", pctx);
        },
      },
      { name: "atlassian-read", run: (params, pctx) => runAtlassianRead((params.url as string) ?? "", pctx) },
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
}
