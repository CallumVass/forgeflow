import type { PipelineContext } from "../../runtime/context.js";
import type { RunAgentFn } from "../../runtime/stages.js";
import { archiveRunDir, gcArchive } from "./archive.js";
import { createRunDir } from "./create.js";
import { ensureGitignore } from "./gitignore.js";

/** Minimal pipeline result shape inspected by `withRunLifecycle`. */
interface LifecycleResult {
  isError?: boolean;
}

/**
 * Bracket a pipeline run with a `.forgeflow/run/<runId>/` directory.
 *
 * Nested calls reuse the parent lifecycle. When persistence is disabled,
 * the callback runs unchanged. Otherwise we apply gitignore + GC
 * housekeeping, create the run dir, patch `runAgentFn` to auto-allocate
 * session files, then archive the run based on the result.
 */
export async function withRunLifecycle<T extends LifecycleResult>(
  pctx: PipelineContext,
  runId: string,
  run: (pctx: PipelineContext) => Promise<T>,
): Promise<T> {
  if (pctx.runDir) return run(pctx);

  const config = pctx.sessionsConfig;
  if (!config?.persist) return run(pctx);

  ensureGitignore(pctx.cwd, (msg) => pctx.ctx.ui.notify(msg, "info"));
  gcArchive(pctx.cwd, config);

  const handle = createRunDir(pctx.cwd, runId, config);

  const baseRunAgent = pctx.runAgentFn;
  const wrappedRunAgent: RunAgentFn = (agent, prompt, opts) => {
    if (opts.sessionPath || opts.forkFrom) return baseRunAgent(agent, prompt, opts);
    const label = opts.stageName ?? agent;
    const sessionPath = handle.allocSessionPath(label);
    return baseRunAgent(agent, prompt, { ...opts, sessionPath });
  };

  const innerPctx: PipelineContext = {
    ...pctx,
    runDir: handle,
    runAgentFn: wrappedRunAgent,
  };

  try {
    const result = await run(innerPctx);
    archiveRunDir(pctx.cwd, handle, result?.isError ? "failed" : "success");
    return result;
  } catch (err) {
    archiveRunDir(pctx.cwd, handle, "failed");
    throw err;
  }
}
