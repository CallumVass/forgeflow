import { emptyStage, type PipelineContext, type StageResult } from "@callumvass/forgeflow-shared/pipeline";

/**
 * A single sub-agent invocation in a chain. Chains are linear lists of
 * phases; `runChain` iterates them, threads fork lineage through
 * `sessionPath` / `forkFrom`, and passes `customPrompt` into the first
 * phase of each sub-chain only.
 */
export interface Phase {
  /** Agent file stem used for the `pi` invocation (matches `packages/dev/agents/*.md`). */
  agent: string;
  /**
   * Optional display/lookup stage name. Used when a phase spawns the
   * same agent under a different identity (e.g. `fix-findings` calling
   * the implementor agent). Defaults to `agent`.
   */
  stageName?: string;
  /**
   * When `true`, this phase starts a fresh sub-chain: `forkFrom` is
   * cleared before the call and `isFirstInChain` flips back to `true`
   * for this phase's `buildTask`. Used to preserve adversarial
   * independence at the build-chain → review-chain boundary.
   */
  resetFork?: boolean;
  /**
   * Build the task prompt for this phase. Receives:
   * - `isFirstInChain`: `true` on the first phase of the chain and
   *   immediately after any `resetFork: true`. Typically used by
   *   cold-start-aware builders to decide whether to include fat
   *   context (issue body etc.) that forked phases inherit via
   *   conversation history.
   * - `customPrompt`: the user's additional instructions, populated
   *   ONLY on first-in-chain phases. `runChain` scopes this
   *   automatically so downstream phases in the same chain receive
   *   `undefined` and pick the custom prompt up via fork-inherited
   *   history from the first phase.
   * - `plan`: captured plan text from the planning phase, or undefined.
   *   Cold-start phases that run without planner inheritance use this
   *   to include the plan explicitly.
   */
  buildTask: (ctx: PhaseBuildCtx) => string;
}

/** Context passed to each phase's `buildTask`. */
export interface PhaseBuildCtx {
  isFirstInChain: boolean;
  customPrompt?: string;
  plan?: string;
}

/** Options for `runChain`. */
interface RunChainOptions {
  pipeline: string;
  stages: StageResult[];
  customPrompt?: string;
  /**
   * Captured plan text to thread into every phase's `buildTask` as
   * context. Separate from `customPrompt` because downstream phases
   * typically reference the plan even when they inherit it via fork
   * (cold-start paths need it too).
   */
  plan?: string;
  /**
   * When set, the first phase in `phases` uses this as its `forkFrom`
   * even though it is the first in the chain. Used by
   * `runImplementation` to thread the planner's session into the
   * implementor phase without making planning itself a chain phase.
   */
  initialForkFrom?: string;
}

/** Result of a `runChain` invocation. */
interface ChainResult {
  /**
   * All stages appended by the chain, in order. Same reference as
   * `options.stages` — `runChain` does not clone it.
   */
  stages: StageResult[];
  /**
   * Session path of the last phase that ran. When sessions are
   * persisted, callers thread this as `initialForkFrom` on a follow-up
   * `runChain` call (e.g. fix-findings forks from the review chain's
   * last session).
   */
  lastSessionPath: string | undefined;
}

/**
 * Execute a linear chain of phases with fork-lineage threading.
 *
 * Behaviour per phase:
 * 1. If `resetFork` is set, clear `forkFrom` and mark this phase as
 *    first-in-chain (so `customPrompt` folds back in).
 * 2. Ensure a `StageResult` with the phase's stage name exists in
 *    `stages`; create one if not.
 * 3. Call `buildTask` with the live `isFirstInChain` / `customPrompt`
 *    / `plan` context to produce the prompt.
 * 4. Allocate a session path via `pctx.runDir?.allocSessionPath(stageName)`
 *    if persistence is on; otherwise leave undefined and let
 *    `runAgent` fall back to `--no-session`.
 * 5. Invoke `pctx.runAgentFn` with `sessionPath` and `forkFrom`
 *    populated.
 * 6. Set the next phase's `forkFrom` to this phase's `sessionPath`
 *    (undefined propagates correctly when persistence is off).
 *
 * `runChain` does not inspect the agent's output, handle signal files,
 * or drive dynamic phase appends. Callers do that in the outer
 * pipeline by inspecting `stages` / signals after the chain returns
 * and calling `runChain` again with `initialForkFrom: result.lastSessionPath`.
 * Keeping the chain-builder pure makes testing and reasoning simpler.
 */
export async function runChain(phases: Phase[], pctx: PipelineContext, options: RunChainOptions): Promise<ChainResult> {
  const { pipeline, stages, customPrompt, plan, initialForkFrom } = options;

  let forkFrom: string | undefined = initialForkFrom;
  let isFirstInChain = true;
  let lastSessionPath: string | undefined;

  for (const phase of phases) {
    if (phase.resetFork) {
      forkFrom = undefined;
      isFirstInChain = true;
    }

    const stageName = phase.stageName ?? phase.agent;
    if (!stages.some((s) => s.name === stageName)) {
      stages.push(emptyStage(stageName));
    }

    const task = phase.buildTask({
      isFirstInChain,
      // Scoped: only first-in-chain phases see the custom prompt in
      // their task builder. Downstream phases inherit it via fork.
      customPrompt: isFirstInChain ? customPrompt : undefined,
      plan,
    });
    const sessionPath = pctx.runDir?.allocSessionPath(stageName);

    await pctx.runAgentFn(phase.agent, task, {
      agentsDir: pctx.agentsDir,
      cwd: pctx.cwd,
      signal: pctx.signal,
      onUpdate: pctx.onUpdate,
      agentOverrides: pctx.agentOverrides,
      selectedSkills: pctx.selectedSkills,
      stages,
      pipeline,
      stageName: phase.stageName,
      sessionPath,
      forkFrom,
    });

    forkFrom = sessionPath;
    lastSessionPath = sessionPath;
    isFirstInChain = false;
  }

  return { stages, lastSessionPath };
}
