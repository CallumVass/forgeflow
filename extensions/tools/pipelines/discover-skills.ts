import { TOOLS_ALL, TOOLS_NO_EDIT } from "../constants.js";
import { runAgent } from "../run-agent.js";
import { type AnyCtx, emptyStage } from "../types.js";

export async function runDiscoverSkills(
  cwd: string,
  query: string,
  signal: AbortSignal,
  onUpdate: AnyCtx,
  _ctx: AnyCtx,
) {
  // If query looks like specific skill names (contains commas or known skill identifiers),
  // treat as install mode. Otherwise, discover mode.
  const isInstall = query.includes(",") || query.includes("/");

  const stages = [emptyStage("skill-discoverer")];
  const opts = { cwd, signal, stages, pipeline: "discover-skills", onUpdate };

  const task = isInstall
    ? `Install these skills as forgeflow plugins: ${query}`
    : query
      ? `Discover skills related to "${query}" — recommend only, do NOT install.`
      : "Analyze the project tech stack and discover relevant skills — recommend only, do NOT install.";

  // Install mode needs write access, discover mode is read-only
  const tools = isInstall ? TOOLS_ALL : TOOLS_NO_EDIT;

  await runAgent("skill-discoverer", task, { ...opts, tools });

  return {
    content: [{ type: "text" as const, text: "Skill discovery complete." }],
    details: { pipeline: "discover-skills", stages },
  };
}
