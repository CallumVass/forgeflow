import {
  emptyStage,
  type PipelineContext,
  pipelineResult,
  TOOLS_ALL,
  TOOLS_NO_EDIT,
  toAgentOpts,
} from "@callumvass/forgeflow-shared/pipeline";

export async function runDiscoverSkills(query: string, pctx: PipelineContext) {
  // If query looks like specific skill names (contains commas or known skill identifiers),
  // treat as install mode. Otherwise, discover mode.
  const isInstall = query.includes(",") || query.includes("/");

  const stages = [emptyStage("skill-discoverer")];
  const opts = toAgentOpts(pctx, { stages, pipeline: "discover-skills" });

  const task = isInstall
    ? `Install these skills as forgeflow plugins: ${query}`
    : query
      ? `Discover skills related to "${query}" — recommend only, do NOT install.`
      : "Analyze the project tech stack and discover relevant skills — recommend only, do NOT install.";

  // Install mode needs write access, discover mode is read-only
  const tools = isInstall ? TOOLS_ALL : TOOLS_NO_EDIT;

  const result = await pctx.runAgentFn("skill-discoverer", task, { ...opts, tools });

  return pipelineResult(result.output || "No skills found.", "discover-skills", stages);
}
