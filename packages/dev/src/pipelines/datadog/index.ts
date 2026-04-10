import {
  type PipelineContext,
  pipelineResult,
  type StageResult,
  withRunLifecycle,
} from "@callumvass/forgeflow-shared/pipeline";
import { formatLambdaCandidate } from "./candidate.js";
import { exploreLambdaWithAgent } from "./explorer.js";
import { runDatadogInvestigation } from "./investigation/index.js";
import { parseDatadogRequest } from "./request.js";

export async function runDatadog(prompt: string, pctx: PipelineContext) {
  return withRunLifecycle(pctx, "datadog", (innerPctx) => runDatadogInner(prompt, innerPctx));
}

async function runDatadogInner(prompt: string, pctx: PipelineContext) {
  const stages: StageResult[] = [];

  if (!prompt && pctx.ctx.hasUI) {
    const input = await pctx.ctx.ui.input("Datadog prompt?", "e.g. investigate why the billing lambda is slow in prod");
    prompt = input?.trim() ?? "";
  }

  if (!prompt) return pipelineResult("No Datadog prompt provided.", "datadog", stages);

  const request = parseDatadogRequest(prompt);
  const agentResolution = await exploreLambdaWithAgent(prompt, pctx, stages);
  if (typeof agentResolution === "string") return pipelineResult(agentResolution, "datadog", stages, true);

  const selected = agentResolution.selected;
  if (!selected && agentResolution.ambiguous && agentResolution.candidates.length > 0) {
    const options = agentResolution.candidates
      .slice(0, 5)
      .map((candidate) => `- ${formatLambdaCandidate(candidate)}`)
      .join("\n");
    return pipelineResult(
      `I found multiple plausible Lambda candidates. Please re-run /datadog with one of these names:\n${options}`,
      "datadog",
      stages,
    );
  }

  if (!selected) {
    return pipelineResult("No Lambda candidate was selected for the Datadog investigation.", "datadog", stages, true);
  }

  const report = await runDatadogInvestigation({ prompt, request, candidate: selected, pctx });
  return pipelineResult(report, "datadog", stages);
}
