import { runAgent } from "@callumvass/forgeflow-shared/agent";
import { type ConfluencePage, fetchConfluencePage } from "@callumvass/forgeflow-shared/confluence";
import { TOOLS_ALL } from "@callumvass/forgeflow-shared/constants";
import { type PipelineContext, toAgentOpts } from "@callumvass/forgeflow-shared/context";
import { emptyStage, pipelineResult } from "@callumvass/forgeflow-shared/stage";

export async function runInvestigate(description: string, templateUrl: string, pctx: PipelineContext) {
  const { ctx } = pctx;
  const interactive = ctx.hasUI;

  // Ask for required description interactively if not provided
  if (!description && interactive) {
    const input = await ctx.ui.input("What should we investigate?", "");
    description = input?.trim() ?? "";
  }
  if (!description) {
    return pipelineResult("No description provided.", "investigate", []);
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
      return pipelineResult(result, "investigate", [], true);
    }
    const page = result as ConfluencePage;
    templateSection = `\n\nTEMPLATE (from Confluence page "${page.title}"):\n\n${page.body}`;
  }

  const stages = [emptyStage("investigator")];
  const opts = toAgentOpts(pctx, { stages, pipeline: "investigate" });

  const task = `Investigate the following and produce a document using the template provided.

TOPIC: ${description}${templateSection}

${!templateUrl ? "No template was provided. Structure your output as: Problem, Context, Options (with comparison table), Recommendation, Next Steps." : ""}

Read the writing-style skill before writing.`;

  await runAgent("investigator", task, { ...opts, tools: TOOLS_ALL });

  return pipelineResult("Investigation complete.", "investigate", stages);
}
