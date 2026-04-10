import {
  createJiraIssueViaOauth,
  extractJiraKey,
  extractProjectKey,
  fetchJiraIssueFromUrl,
  getJiraCreationDefaults,
} from "@callumvass/forgeflow-shared/atlassian";
import { type ConfluencePage, fetchConfluencePage } from "@callumvass/forgeflow-shared/confluence";
import {
  emitUpdate,
  emptyStage,
  type PipelineContext,
  pipelineResult,
  toAgentOpts,
  withRunLifecycle,
} from "@callumvass/forgeflow-shared/pipeline";
import { parseJiraIssueDrafts } from "./jira-output.js";

export async function runJiraIssues(docUrls: string[], exampleUrl: string, pctx: PipelineContext) {
  return withRunLifecycle(pctx, "create-jira-issues", (innerPctx) =>
    runJiraIssuesInner(docUrls, exampleUrl, innerPctx),
  );
}

async function runJiraIssuesInner(docUrls: string[], exampleUrl: string, pctx: PipelineContext) {
  const { ctx } = pctx;
  const interactive = ctx.hasUI;

  if (docUrls.length === 0 && interactive) {
    const input = await ctx.ui.input("Confluence doc URL(s)?", "Space-separated");
    if (input != null && input.trim() !== "") {
      docUrls = input.trim().split(/\s+/).filter(Boolean);
    }
  }
  if (docUrls.length === 0) {
    return pipelineResult("No document URLs provided.", "create-jira-issues", []);
  }

  if (!exampleUrl && interactive) {
    const input = await ctx.ui.input("Example ticket URL?", "Skip");
    if (input != null && input.trim() !== "") {
      exampleUrl = input.trim();
    }
  }

  const docs: ConfluencePage[] = [];
  for (const url of docUrls) {
    const result = await fetchConfluencePage(url, pctx.execSafeFn);
    if (typeof result === "string") {
      return pipelineResult(`Failed to fetch doc: ${result}`, "create-jira-issues", [], true);
    }
    docs.push(result);
  }

  return runOauthJiraIssueCreation(docs, exampleUrl, pctx);
}

async function runOauthJiraIssueCreation(docs: ConfluencePage[], exampleUrl: string, pctx: PipelineContext) {
  const docSections = docs.map((d, i) => `DOCUMENT ${i + 1}: "${d.title}"\n\n${d.body}`).join("\n\n---\n\n");
  const defaults = getJiraCreationDefaults();
  const exampleIssueUrl = extractJiraKey(exampleUrl) ? exampleUrl : undefined;

  let exampleSection = "";
  let projectKey = defaults.projectKey;
  let defaultIssueType = defaults.issueType;

  if (exampleIssueUrl) {
    const exampleIssue = await fetchJiraIssueFromUrl(exampleIssueUrl, { signal: pctx.signal });
    if (typeof exampleIssue === "string") {
      return pipelineResult(`Failed to fetch example: ${exampleIssue}`, "create-jira-issues", [], true);
    }
    exampleSection = `\n\nEXAMPLE TICKET (match this format):\nTitle: ${exampleIssue.title}\n\n${exampleIssue.body}`;
    projectKey = projectKey ?? extractProjectKey(exampleIssue.key);
    defaultIssueType = exampleIssue.issueType ?? defaultIssueType;
  } else if (exampleUrl) {
    const result = await fetchConfluencePage(exampleUrl, pctx.execSafeFn);
    if (typeof result === "string") {
      return pipelineResult(`Failed to fetch example: ${result}`, "create-jira-issues", [], true);
    }
    exampleSection = `\n\nEXAMPLE TICKET (match this format):\nTitle: ${result.title}\n\n${result.body}`;
  }

  if (!projectKey) {
    return pipelineResult(
      "Missing Jira project target. Set ATLASSIAN_JIRA_PROJECT, or provide a Jira example ticket URL so forgeflow can infer the project key.",
      "create-jira-issues",
      [],
      true,
    );
  }

  const stages = [emptyStage("jira-issue-planner"), emptyStage("jira-issue-publisher")];
  const opts = toAgentOpts(pctx, { stages, pipeline: "create-jira-issues" });

  const task = `Decompose the following PM documents into vertical-slice Jira issues.

${docSections}${exampleSection}

Return ONLY JSON in this exact shape:

\`\`\`json
[
  {
    "summary": "Short Jira summary",
    "description": "Full ticket body in the target team's format, including any headings and acceptance criteria.",
    "issueType": "Optional override when this issue is not a ${defaultIssueType}"
  }
]
\`\`\`

Do not create any Jira issues yourself. Forgeflow will publish the JSON output via Atlassian MCP.
Read the writing-style skill before writing any issue content.`;

  await pctx.runAgentFn("jira-issue-planner", task, opts);

  const drafts = parseJiraIssueDrafts(stages[0]?.output ?? "");
  const publisherStage = stages[1];
  if (!publisherStage) {
    return pipelineResult("Internal error: missing jira-issue-publisher stage.", "create-jira-issues", stages, true);
  }
  if (typeof drafts === "string") {
    publisherStage.status = "failed";
    publisherStage.exitCode = 1;
    publisherStage.output = drafts;
    return pipelineResult(drafts, "create-jira-issues", stages, true);
  }

  publisherStage.status = "running";
  publisherStage.output = `Creating ${drafts.length} Jira issue${drafts.length === 1 ? "" : "s"} in ${projectKey}...`;
  emitUpdate({ stages, pipeline: "create-jira-issues", onUpdate: pctx.onUpdate });

  const createdKeys: string[] = [];
  for (const draft of drafts) {
    const created = await createJiraIssueViaOauth(
      {
        projectKey,
        summary: draft.summary,
        description: draft.description,
        issueType: draft.issueType ?? defaultIssueType,
      },
      { signal: pctx.signal, ...(exampleIssueUrl ? { siteUrl: exampleIssueUrl } : {}) },
    );

    if (typeof created === "string") {
      publisherStage.status = "failed";
      publisherStage.exitCode = 1;
      publisherStage.output =
        createdKeys.length > 0 ? `${created}\n\nCreated before failure: ${createdKeys.join(", ")}` : created;
      return pipelineResult(
        `Failed to create Jira issues: ${publisherStage.output}`,
        "create-jira-issues",
        stages,
        true,
      );
    }

    createdKeys.push(created.key);
    publisherStage.output = `Created ${createdKeys.length}/${drafts.length}: ${createdKeys.join(", ")}`;
    emitUpdate({ stages, pipeline: "create-jira-issues", onUpdate: pctx.onUpdate });
  }

  publisherStage.status = "done";
  publisherStage.exitCode = 0;
  publisherStage.output = `Created Jira issues: ${createdKeys.join(", ")}`;

  return pipelineResult(`Jira issue creation complete: ${createdKeys.join(", ")}`, "create-jira-issues", stages);
}
