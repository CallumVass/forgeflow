import { runAgent } from "@callumvass/forgeflow-shared/agent";
import { type ConfluencePage, fetchConfluencePage } from "@callumvass/forgeflow-shared/confluence";
import { TOOLS_ALL } from "@callumvass/forgeflow-shared/constants";
import { type PipelineContext, toAgentOpts } from "@callumvass/forgeflow-shared/context";
import { emptyStage, pipelineResult } from "@callumvass/forgeflow-shared/stage";

export async function runJiraIssues(docUrls: string[], exampleUrl: string, pctx: PipelineContext) {
  const { ctx } = pctx;
  const interactive = ctx.hasUI;

  // Ask for required doc URLs interactively if not provided
  if (docUrls.length === 0 && interactive) {
    const input = await ctx.ui.input("Confluence doc URL(s)?", "Space-separated");
    if (input != null && input.trim() !== "") {
      docUrls = input.trim().split(/\s+/).filter(Boolean);
    }
  }
  if (docUrls.length === 0) {
    return pipelineResult("No document URLs provided.", "create-jira-issues", []);
  }

  // Ask for optional example URL interactively if not provided
  if (!exampleUrl && interactive) {
    const input = await ctx.ui.input("Example ticket URL?", "Skip");
    if (input != null && input.trim() !== "") {
      exampleUrl = input.trim();
    }
  }

  // Fetch all Confluence pages
  const docs: ConfluencePage[] = [];
  for (const url of docUrls) {
    const result = await fetchConfluencePage(url);
    if (typeof result === "string") {
      return pipelineResult(`Failed to fetch doc: ${result}`, "create-jira-issues", [], true);
    }
    docs.push(result as ConfluencePage);
  }

  let exampleSection = "";
  if (exampleUrl) {
    const result = await fetchConfluencePage(exampleUrl);
    if (typeof result === "string") {
      return pipelineResult(`Failed to fetch example: ${result}`, "create-jira-issues", [], true);
    }
    const page = result as ConfluencePage;
    exampleSection = `\n\nEXAMPLE TICKET (match this format):\nTitle: ${page.title}\n\n${page.body}`;
  }

  const docSections = docs.map((d, i) => `DOCUMENT ${i + 1}: "${d.title}"\n\n${d.body}`).join("\n\n---\n\n");

  const stages = [emptyStage("jira-issue-creator")];
  const opts = toAgentOpts(pctx, { stages, pipeline: "create-jira-issues" });

  const task = `Decompose the following PM documents into vertical-slice Jira issues.

${docSections}${exampleSection}

${!exampleUrl ? "No example ticket was provided. Use standard format: Summary, Description, Acceptance Criteria." : ""}

Read the writing-style skill before writing any issue content.`;

  await runAgent("jira-issue-creator", task, { ...opts, tools: TOOLS_ALL });

  return pipelineResult("Jira issue creation complete.", "create-jira-issues", stages);
}
