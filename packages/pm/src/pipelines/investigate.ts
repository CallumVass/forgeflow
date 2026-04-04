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
  _ctx: AnyCtx,
) {
  if (!description) {
    return {
      content: [{ type: "text" as const, text: "No description provided." }],
      details: { pipeline: "investigate", stages: [] },
    };
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
