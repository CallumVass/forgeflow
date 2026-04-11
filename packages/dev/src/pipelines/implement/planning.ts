import {
  emptyStage,
  type ForgeflowContext,
  type PipelineContext,
  type StageResult,
} from "@callumvass/forgeflow-shared/pipeline";
import { parseCandidates } from "../architecture-review/index.js";
import { appendArchitecturalNotes } from "./plan-architecture.js";

interface PlanResult {
  plan: string;
  cancelled: boolean;
  failed?: boolean;
  errorStage?: "planner" | "architecture-reviewer";
  stages: StageResult[];
  /**
   * Session path of the final planning phase (architecture-reviewer
   * when it ran, planner otherwise). Threaded as `initialForkFrom`
   * into the build chain so the implementor inherits the plan's tool
   * results and assistant turns.
   *
   * `undefined` when session persistence is disabled.
   */
  lastSessionPath: string | undefined;
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
 * Append a user turn to an existing pi session file by invoking
 * `pi --session <path> -p "<message>"`. Used to persist an interactive
 * plan edit (and unresolved-question answers) as a real conversation
 * turn in the planner's session, so the implementor inherits the
 * edited plan via fork rather than via a prompt blob.
 *
 * Fail-soft: any shell error is caught and reported via the UI — the
 * pipeline continues using the edited plan text even if the append
 * failed, so the user's work is never silently lost.
 */
async function appendUserTurnToSession(sessionPath: string, message: string, pctx: PipelineContext): Promise<void> {
  // `-p "<msg>"` runs pi non-interactively; we ignore stdout because the
  // side effect is the on-disk session file, not the return value.
  const quoted = message.replace(/'/g, `'\\''`);
  try {
    await pctx.execFn(`pi --session "${sessionPath}" -p --mode json '${quoted}'`, pctx.cwd);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    pctx.ctx.ui.notify(
      `forgeflow: failed to persist plan edit to session file (${msg}). Continuing with edited plan in-memory.`,
      "warning",
    );
  }
}

/**
 * Run the planning phase: planner (cold) + optional architecture-reviewer
 * (forked from planner) + optional interactive edit.
 *
 * Owns session-path allocation explicitly instead of going through the
 * chain-builder: the interactive edit and unresolved-question flows
 * mutate session state mid-run via `pi --session`, which does not fit
 * the generic chain API. Returns the final session path so the caller
 * can thread it into the build chain as `initialForkFrom`.
 */
export async function runPlanning(
  issueContext: string,
  customPrompt: string | undefined,
  opts: PipelineContext & {
    interactive: boolean;
    stages: StageResult[];
  },
): Promise<PlanResult> {
  const { ctx, interactive, stages, runAgentFn, runDir } = opts;

  if (!stages.some((s) => s.name === "planner")) stages.push(emptyStage("planner"));

  const customPromptSection = customPrompt ? `\n\nADDITIONAL INSTRUCTIONS FROM USER:\n${customPrompt}` : "";
  const plannerSessionPath = runDir?.allocSessionPath("planner");

  const planResult = await runAgentFn(
    "planner",
    `Plan the implementation for this issue by producing a sequenced list of test cases.\n\n${issueContext}${customPromptSection}`,
    {
      agentsDir: opts.agentsDir,
      cwd: opts.cwd,
      signal: opts.signal,
      onUpdate: opts.onUpdate,
      agentOverrides: opts.agentOverrides,
      selectedSkills: opts.selectedSkills,
      stages,
      pipeline: "implement",
      sessionPath: plannerSessionPath,
    },
  );

  if (planResult.status === "failed") {
    return {
      plan: planResult.output,
      cancelled: false,
      failed: true,
      errorStage: "planner",
      stages,
      lastSessionPath: plannerSessionPath,
    };
  }

  let plan = planResult.output;

  // Architecture critique: forks the planner's session so the reviewer
  // inherits the planner's exploration rather than cold-reading the
  // codebase. Its output is parsed back into structured notes and
  // appended to the plan text; the planner session stays as the
  // ground-truth artefact.
  if (!stages.some((s) => s.name === "architecture-reviewer")) {
    stages.push(emptyStage("architecture-reviewer"));
  }
  const archSessionPath = runDir?.allocSessionPath("architecture-reviewer");
  const reviewerPrompt = `Review this implementation plan against the existing codebase. Focus ONLY on what the plan touches — this is not a full architecture audit.\n\nISSUE CONTEXT:\n${issueContext}\n\nIMPLEMENTATION PLAN:\n${plan}\n\nLook for:\n- Existing shared utilities or patterns in the codebase the plan should reuse instead of creating new ones\n- Modules the plan would push over 300 lines\n- Duplication the plan would create across packages\n- Type safety concerns (any escape hatches, missing interfaces)\n- Opportunities to use or extend existing shared abstractions\n\nPresent numbered recommendations in candidate format. If the plan already follows good patterns, say "No architectural recommendations" and stop.`;

  const reviewResult = await runAgentFn("architecture-reviewer", reviewerPrompt, {
    agentsDir: opts.agentsDir,
    cwd: opts.cwd,
    signal: opts.signal,
    onUpdate: opts.onUpdate,
    agentOverrides: opts.agentOverrides,
    selectedSkills: opts.selectedSkills,
    stages,
    pipeline: "implement",
    sessionPath: archSessionPath,
    forkFrom: plannerSessionPath,
  });

  if (reviewResult.status === "failed") {
    return {
      plan: reviewResult.output,
      cancelled: false,
      failed: true,
      errorStage: "architecture-reviewer",
      stages,
      lastSessionPath: archSessionPath ?? plannerSessionPath,
    };
  }

  const candidates = parseCandidates(reviewResult.output);
  plan = appendArchitecturalNotes(plan, candidates);

  // The architecture-reviewer's session is the tail of the planning
  // sub-chain. It is what downstream build-chain phases should fork
  // from (implementor inherits planner reads + arch-reviewer critique
  // in one go).
  const tailSessionPath = archSessionPath ?? plannerSessionPath;

  // Interactive mode: let user review/edit the plan before proceeding
  if (interactive && plan) {
    const edited = await ctx.ui.editor("Review implementation plan", plan);
    const editApplied = edited != null && edited !== plan;
    if (editApplied && edited) {
      plan = edited;
    }

    // Surface unresolved questions one-by-one for user answers
    const planBeforeAnswers = plan;
    plan = await resolveQuestions(plan, ctx);
    const answersApplied = plan !== planBeforeAnswers;

    // Persist the edited plan as a user turn on the planning chain's
    // tail session so the implementor, when it forks, inherits the
    // revised plan in its actual conversation history rather than
    // receiving a prompt blob. No-op when persistence is disabled.
    if ((editApplied || answersApplied) && tailSessionPath) {
      await appendUserTurnToSession(
        tailSessionPath,
        `Updated implementation plan (user edits applied):\n\n${plan}`,
        opts,
      );
      // After the append, the tail session is still the same file —
      // it just has an extra user turn appended. No new allocation.
    }

    const action = await ctx.ui.select("Plan ready. What next?", ["Approve and implement", "Cancel"]);
    if (action === "Cancel" || action == null) {
      return { plan, cancelled: true, stages, lastSessionPath: tailSessionPath };
    }
  }

  return { plan, cancelled: false, stages, lastSessionPath: tailSessionPath };
}
