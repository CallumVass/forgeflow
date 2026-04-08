import { emptyStage, type PipelineContext, pipelineResult, toAgentOpts } from "@callumvass/forgeflow-shared/pipeline";

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

  // The agent's .md frontmatter is the single source of truth for its tool
  // list — the agent's own prompt gates when `edit` is appropriate (install
  // mode vs discover mode).
  const result = await pctx.runAgentFn("skill-discoverer", task, opts);

  return pipelineResult(result.output || "No skills found.", "discover-skills", stages);
}
