import { emptyStage, type PipelineContext, type StageResult, toAgentOpts } from "@callumvass/forgeflow-shared/pipeline";
import { formatLambdaCandidate, type LambdaCandidate } from "./resolver.js";

interface AgentResolutionPayload {
  selected?: LambdaCandidate;
  candidates: LambdaCandidate[];
  ambiguous: boolean;
}

function extractJsonBlock(text: string): string | undefined {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  if (fenced) return fenced;

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toCandidate(value: unknown): LambdaCandidate | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.file !== "string" || typeof value.line !== "number") return undefined;

  return {
    file: value.file,
    line: value.line,
    variableName: typeof value.variableName === "string" ? value.variableName : undefined,
    className: typeof value.className === "string" ? value.className : undefined,
    functionName: typeof value.functionName === "string" ? value.functionName : undefined,
    constructId: typeof value.constructId === "string" ? value.constructId : undefined,
    handler: typeof value.handler === "string" ? value.handler : undefined,
    entry: typeof value.entry === "string" ? value.entry : undefined,
    runtime: typeof value.runtime === "string" ? value.runtime : undefined,
    codePath: typeof value.codePath === "string" ? value.codePath : undefined,
    score: typeof value.score === "number" ? value.score : 0,
    reasons:
      Array.isArray(value.reasons) && value.reasons.every((item) => typeof item === "string")
        ? (value.reasons as string[])
        : [],
  };
}

export function parseAgentLambdaResolution(output: string): AgentResolutionPayload | string {
  const jsonBlock = extractJsonBlock(output);
  if (!jsonBlock) return "The Datadog resolver agent returned no JSON payload.";

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonBlock);
  } catch {
    return "The Datadog resolver agent returned invalid JSON.";
  }

  if (!isRecord(parsed)) return "The Datadog resolver agent returned an unexpected payload.";

  const selected = toCandidate(parsed.selected);
  const candidates = Array.isArray(parsed.candidates)
    ? parsed.candidates.map(toCandidate).filter((candidate): candidate is LambdaCandidate => Boolean(candidate))
    : [];
  const ambiguous = typeof parsed.ambiguous === "boolean" ? parsed.ambiguous : !selected && candidates.length > 1;

  return { selected, candidates, ambiguous };
}

function buildResolverPrompt(prompt: string, hints: LambdaCandidate[]): string {
  const hintText =
    hints.length > 0
      ? hints
          .slice(0, 8)
          .map((candidate) => `- ${formatLambdaCandidate(candidate)}`)
          .join("\n")
      : "- none";

  return [
    "Resolve which AWS Lambda the user means for a Datadog investigation.",
    "Explore the repository directly using tools. Do not rely only on the hints below.",
    "Be thorough across TypeScript, JavaScript, C#, infra folders, hidden folders like .infra, CDK, CloudFormation, Terraform, and custom constructs from private libraries.",
    "Prefer the deployed Lambda function name when it is explicitly derivable from code. If it is not explicit, leave functionName omitted rather than inventing one.",
    "Return STRICT JSON only with this shape:",
    '{"selected": {"file":"...","line":1,"variableName":"...","className":"...","functionName":"...","constructId":"...","handler":"...","entry":"...","runtime":"...","codePath":"..."} | null, "candidates": [{...}], "ambiguous": true|false}',
    "Include up to 5 plausible candidates in candidates.",
    "If there is one clear best match, set selected to it and ambiguous=false.",
    "If there are multiple similarly plausible matches, set selected=null and ambiguous=true.",
    "If nothing is found, return selected=null, candidates=[], ambiguous=false.",
    "",
    `User prompt: ${prompt}`,
    "",
    "Deterministic hints from forgeflow:",
    hintText,
  ].join("\n");
}

export async function exploreLambdaWithAgent(
  prompt: string,
  hints: LambdaCandidate[],
  pctx: PipelineContext,
  stages: StageResult[],
): Promise<AgentResolutionPayload | string> {
  stages.push(emptyStage("resolve-lambda"));
  const agentResult = await pctx.runAgentFn("datadog-resolver", buildResolverPrompt(prompt, hints), {
    ...toAgentOpts(pctx, { stages, pipeline: "datadog" }),
    stageName: "resolve-lambda",
  });

  if (agentResult.status === "failed") {
    return `Lambda exploration failed: ${agentResult.output}`;
  }

  return parseAgentLambdaResolution(agentResult.output);
}
