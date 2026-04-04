import {
  type AnyCtx,
  type ConfluencePage,
  emptyStage,
  fetchConfluencePage,
  runAgent,
  TOOLS_ALL,
} from "@callumvass/forgeflow-shared";
import { AGENTS_DIR } from "../resolve.js";

export async function runInvestigate(
  cwd: string,
  description: string,
  templateUrl: string,
  signal: AbortSignal,
  onUpdate: AnyCtx,
  ctx: AnyCtx,
) {
  const interactive = ctx.hasUI;

  // Ask for required description interactively if not provided
  if (!description && interactive) {
    const input = await ctx.ui.input("What should we investigate?", "");
    description = input?.trim() ?? "";
  }
  if (!description) {
    return {
      content: [{ type: "text" as const, text: "No description provided." }],
      details: { pipeline: "investigate", stages: [] },
    };
  }

  // Ask for optional template URL interactively if not provided
  if (!templateUrl && interactive) {
    const input = await ctx.ui.input("Confluence template URL?", "Skip");
    if (input != null && input.trim() !== "") {
      templateUrl = input.trim();
    }
  }

  let templateSection = "";
  if (templateUrl) {
    const result = await fetchConfluencePage(templateUrl);
    if (typeof result === "string") {
      return {
        content: [{ type: "text" as const, text: result }],
        details: { pipeline: "investigate", stages: [] },
        isError: true,
      };
    }
    const page = result as ConfluencePage;
    templateSection = `\n\nTEMPLATE (from Confluence page "${page.title}"):\n\n${page.body}`;
  }

  const stages = [emptyStage("investigator")];
  const opts = { agentsDir: AGENTS_DIR, cwd, signal, stages, pipeline: "investigate", onUpdate };

  const task = `Investigate the following and produce a document using the template provided.

TOPIC: ${description}${templateSection}

${!templateUrl ? "No template was provided. Structure your output as: Problem, Context, Options (with comparison table), Recommendation, Next Steps." : ""}

Read the writing-style skill before writing.`;

  await runAgent("investigator", task, { ...opts, tools: TOOLS_ALL });

  return {
    content: [{ type: "text" as const, text: "Investigation complete." }],
    details: { pipeline: "investigate", stages },
  };
}
