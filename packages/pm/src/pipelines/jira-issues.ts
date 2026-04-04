import {
  type AnyCtx,
  type ConfluencePage,
  emptyStage,
  fetchConfluencePage,
  runAgent,
  TOOLS_ALL,
} from "@callumvass/forgeflow-shared";
import { AGENTS_DIR } from "../resolve.js";

export async function runJiraIssues(
  cwd: string,
  docUrls: string[],
  exampleUrl: string,
  signal: AbortSignal,
  onUpdate: AnyCtx,
  _ctx: AnyCtx,
) {
  if (docUrls.length === 0) {
    return {
      content: [{ type: "text" as const, text: "No document URLs provided." }],
      details: { pipeline: "jira-issues", stages: [] },
    };
  }

  // Fetch all Confluence pages
  const docs: ConfluencePage[] = [];
  for (const url of docUrls) {
    const result = await fetchConfluencePage(url);
    if (typeof result === "string") {
      return {
        content: [{ type: "text" as const, text: `Failed to fetch doc: ${result}` }],
        details: { pipeline: "jira-issues", stages: [] },
        isError: true,
      };
    }
    docs.push(result as ConfluencePage);
  }

  let exampleSection = "";
  if (exampleUrl) {
    const result = await fetchConfluencePage(exampleUrl);
    if (typeof result === "string") {
      return {
        content: [{ type: "text" as const, text: `Failed to fetch example: ${result}` }],
        details: { pipeline: "jira-issues", stages: [] },
        isError: true,
      };
    }
    const page = result as ConfluencePage;
    exampleSection = `\n\nEXAMPLE TICKET (match this format):\nTitle: ${page.title}\n\n${page.body}`;
  }

  const docSections = docs.map((d, i) => `DOCUMENT ${i + 1}: "${d.title}"\n\n${d.body}`).join("\n\n---\n\n");

  const stages = [emptyStage("jira-issue-creator")];
  const opts = { agentsDir: AGENTS_DIR, cwd, signal, stages, pipeline: "jira-issues", onUpdate };

  const task = `Decompose the following PM documents into vertical-slice Jira issues.

${docSections}${exampleSection}

${!exampleUrl ? "No example ticket was provided. Use standard format: Summary, Description, Acceptance Criteria." : ""}

Read the writing-style skill before writing any issue content.`;

  await runAgent("jira-issue-creator", task, { ...opts, tools: TOOLS_ALL });

  return {
    content: [{ type: "text" as const, text: "Jira issue creation complete." }],
    details: { pipeline: "jira-issues", stages },
  };
}
