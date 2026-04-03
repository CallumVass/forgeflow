import { TOOLS_NO_EDIT } from "../constants.js";
import { runAgent } from "../run-agent.js";
import { type AnyCtx, emptyStage } from "../types.js";

export async function runDiscoverSkills(
  cwd: string,
  query: string,
  signal: AbortSignal,
  onUpdate: AnyCtx,
  _ctx: AnyCtx,
) {
  const stages = [emptyStage("skill-discoverer")];
  const opts = { cwd, signal, stages, pipeline: "discover-skills", onUpdate };

  const task = query
    ? `Find and install skills related to: ${query}`
    : "Analyze the project tech stack and find relevant skills to install.";

  await runAgent("skill-discoverer", task, { ...opts, tools: TOOLS_NO_EDIT });

  return {
    content: [{ type: "text" as const, text: "Skill discovery complete." }],
    details: { pipeline: "discover-skills", stages },
  };
}
