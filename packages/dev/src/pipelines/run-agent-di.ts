// biome-ignore lint/suspicious/noExplicitAny: flexible opts to allow DI in tests without coupling to full runAgent signature
export type RunAgentFn = (agent: string, prompt: string, opts: any) => Promise<{ output: string; status: string }>;

/**
 * Resolve a RunAgentFn — use the injected one for tests, or lazy-import the real one.
 */
export async function resolveRunAgent(injected?: RunAgentFn): Promise<RunAgentFn> {
  if (injected) return injected;
  const mod = await import("@callumvass/forgeflow-shared");
  return mod.runAgent as RunAgentFn;
}
