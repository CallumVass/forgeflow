import { runAgent } from "./run-agent.js";
import type { RunAgentFn } from "./types.js";

/**
 * Resolve a RunAgentFn — use the injected one for tests, or return the real one.
 */
export async function resolveRunAgent(injected?: RunAgentFn): Promise<RunAgentFn> {
  if (injected) return injected;
  return runAgent;
}
