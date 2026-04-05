import {
  type ConfluencePage,
  emptyStage,
  type ForgeflowContext,
  fetchConfluencePage,
  type OnUpdate,
  runAgent,
  TOOLS_ALL,
} from "@callumvass/forgeflow-shared";
import { AGENTS_DIR } from "../resolve.js";

export async function runJiraIssues(
  cwd: string,
  docUrls: string[],
  exampleUrl: string,
  signal: AbortSignal,
  onUpdate: OnUpdate | undefined,
  ctx: ForgeflowContext,
) {
  const interactive = ctx.hasUI;

  // Ask for required doc URLs interactively if not provided
  if (docUrls.length === 0 && interactive) {
    const input = await ctx.ui.input("Confluence doc URL(s)?", "Space-separated");
    if (input != null && input.trim() !== "") {
      docUrls = input.trim().split(/\s+/).filter(Boolean);
    }
  }
  if (docUrls.length === 0) {
    return {
      content: [{ type: "text" as const, text: "No document URLs provided." }],
      details: { pipeline: "create-jira-issues", stages: [] },
    };
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
      return {
        content: [{ type: "text" as const, text: `Failed to fetch doc: ${result}` }],
        details: { pipeline: "create-jira-issues", stages: [] },
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
        details: { pipeline: "create-jira-issues", stages: [] },
        isError: true,
      };
    }
    const page = result as ConfluencePage;
    exampleSection = `\n\nEXAMPLE TICKET (match this format):\nTitle: ${page.title}\n\n${page.body}`;
  }

  const docSections = docs.map((d, i) => `DOCUMENT ${i + 1}: "${d.title}"\n\n${d.body}`).join("\n\n---\n\n");

  const stages = [emptyStage("jira-issue-creator")];
  const opts = { agentsDir: AGENTS_DIR, cwd, signal, stages, pipeline: "create-jira-issues", onUpdate };

  const task = `Decompose the following PM documents into vertical-slice Jira issues.

${docSections}${exampleSection}

${!exampleUrl ? "No example ticket was provided. Use standard format: Summary, Description, Acceptance Criteria." : ""}

Read the writing-style skill before writing any issue content.`;

  await runAgent("jira-issue-creator", task, { ...opts, tools: TOOLS_ALL });

  return {
    content: [{ type: "text" as const, text: "Jira issue creation complete." }],
    details: { pipeline: "create-jira-issues", stages },
  };
}
