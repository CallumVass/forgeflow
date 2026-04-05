import {
  type ForgeflowContext,
  type OnUpdate,
  type RunAgentFn,
  resolveRunAgent,
  type StageResult,
  TOOLS_READONLY,
} from "@callumvass/forgeflow-shared";
import { AGENTS_DIR } from "../resolve.js";

export interface PlanResult {
  plan: string;
  cancelled: boolean;
  failed?: boolean;
  stages: StageResult[];
}

/**
 * Parse unresolved questions from the plan and prompt the user for answers.
 * Returns the plan with answers injected inline.
 */
export async function resolveQuestions(plan: string, ctx: ForgeflowContext): Promise<string> {
  const sectionMatch = plan.match(/### Unresolved Questions\n([\s\S]*?)(?=\n###|$)/);
  if (!sectionMatch) return plan;

  const section = sectionMatch[1] ?? "";
  // Match any list prefix: "- ", "1. ", "1) ", "a) ", etc, plus continuation lines
  const itemRe = /^(?:[-*]|\d+[.)]+|[a-z][.)]+)\s+(.+(?:\n(?!(?:[-*]|\d+[.)]+|[a-z][.)]+)\s).*)*)/gm;
  const items: { full: string; text: string }[] = [];
  for (const m of section.matchAll(itemRe)) {
    if (m[0] && m[1]) items.push({ full: m[0], text: m[1] });
  }

  if (items.length === 0) return plan;

  let updatedSection = section;
  for (const item of items) {
    const answer = await ctx.ui.input(`${item.text}`, "Skip to use defaults");
    if (answer != null && answer.trim() !== "") {
      updatedSection = updatedSection.replace(item.full, `${item.full}\n  **Answer:** ${answer.trim()}`);
    }
  }

  return plan.replace(`### Unresolved Questions\n${section}`, `### Unresolved Questions\n${updatedSection}`);
}

/**
 * Run the planning phase: call planner agent, optionally let user review/edit,
 * resolve questions, and get approval.
 */
export async function runPlanning(
  cwd: string,
  issueContext: string,
  customPrompt: string | undefined,
  opts: {
    signal: AbortSignal;
    onUpdate: OnUpdate | undefined;
    ctx: ForgeflowContext;
    interactive: boolean;
    stages: StageResult[];
    runAgentFn?: RunAgentFn;
  },
): Promise<PlanResult> {
  const { signal, onUpdate, ctx, interactive, stages } = opts;

  const runAgentFn = await resolveRunAgent(opts.runAgentFn);

  const customPromptSection = customPrompt ? `\n\nADDITIONAL INSTRUCTIONS FROM USER:\n${customPrompt}` : "";

  const planResult = await runAgentFn(
    "planner",
    `Plan the implementation for this issue by producing a sequenced list of test cases.\n\n${issueContext}${customPromptSection}`,
    { agentsDir: AGENTS_DIR, cwd, signal, stages, pipeline: "implement", onUpdate, tools: TOOLS_READONLY },
  );

  if (planResult.status === "failed") {
    return { plan: planResult.output, cancelled: false, failed: true, stages };
  }

  let plan = planResult.output;

  // Interactive mode: let user review/edit the plan before proceeding
  if (interactive && plan) {
    const edited = await ctx.ui.editor("Review implementation plan", plan);
    if (edited != null && edited !== plan) {
      plan = edited;
    }

    // Surface unresolved questions one-by-one for user answers
    plan = await resolveQuestions(plan, ctx);

    const action = await ctx.ui.select("Plan ready. What next?", ["Approve and implement", "Cancel"]);
    if (action === "Cancel" || action == null) {
      return { plan, cancelled: true, stages };
    }
  }

  return { plan, cancelled: false, stages };
}
