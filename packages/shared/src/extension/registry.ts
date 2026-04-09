// ─── Shared stages-overlay registration ──────────────────────────────
//
// Multiple forgeflow extensions (e.g. forgeflow-pm and forgeflow-dev) can be
// installed side by side. Each call to `createForgeflowExtension` used to
// register its own `/stages` command and `Ctrl+Shift+S` shortcut, which made
// pi log a shortcut conflict at startup and meant only one extension's tool
// name was visible to the overlay.
//
// Instead we keep a single process-wide registry of forgeflow tool names on
// `globalThis` and register the command + shortcut exactly once (on the first
// extension to load). The handlers read the live set, so any extension that
// loads later still has its tool name considered when the overlay opens.

interface StagesOverlayRegistry {
  toolNames: Set<string>;
  registered: boolean;
}

const STAGES_OVERLAY_REGISTRY_KEY = Symbol.for("forgeflow.stagesOverlay.registry");

type GlobalWithRegistry = typeof globalThis & {
  [STAGES_OVERLAY_REGISTRY_KEY]?: StagesOverlayRegistry;
};

/**
 * Get (or lazily create) the process-wide stages-overlay registry. The same
 * instance is returned on repeated calls within the same process so that
 * multiple forgeflow extensions can share a single `/stages` command and
 * shortcut registration.
 */
export function getStagesOverlayRegistry(): StagesOverlayRegistry {
  const g = globalThis as GlobalWithRegistry;
  let registry = g[STAGES_OVERLAY_REGISTRY_KEY];
  if (!registry) {
    registry = { toolNames: new Set<string>(), registered: false };
    g[STAGES_OVERLAY_REGISTRY_KEY] = registry;
  }
  return registry;
}

/**
 * Clear the process-wide stages-overlay registry. Tests use this to ensure
 * each scenario starts from a clean slate; production code may call it during
 * a re-initialisation flow if it ever needs one.
 */
export function resetStagesOverlayRegistry(): void {
  const g = globalThis as GlobalWithRegistry;
  delete g[STAGES_OVERLAY_REGISTRY_KEY];
}
