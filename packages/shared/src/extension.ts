import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerForgeflowCommands } from "./extension-commands.js";
import { buildSchema } from "./extension-schema.js";
import { registerForgeflowTool } from "./extension-tool.js";
import type { ExtensionConfig } from "./extension-types.js";

// ─── Public re-exports ───────────────────────────────────────────────
//
// Consumers (`forgeflow-pm`, `forgeflow-dev`, and any external extension)
// import everything they need from `@callumvass/forgeflow-shared/extension`,
// so this module is the single public entry point. The implementation lives
// in sibling modules (`extension-types`, `extension-message`,
// `extension-schema`, `extension-registry`, `extension-tool`,
// `extension-commands`) but none of those are published.

export { buildSendMessage } from "./extension-message.js";
export type { CommandDefinition, ExtensionConfig, ParamDef, PipelineDefinition } from "./extension-types.js";

// ─── Factory ─────────────────────────────────────────────────────────

/**
 * Create a forgeflow extension from a declarative config. The returned
 * function is the `pi.ExtensionAPI` entry point that wires the tool and all
 * commands (including the shared `/stages` overlay) onto a pi instance.
 */
export function createForgeflowExtension(config: ExtensionConfig): (pi: ExtensionAPI) => void {
  const schema = buildSchema(config);
  return (pi: ExtensionAPI) => {
    registerForgeflowTool(pi, config, schema);
    registerForgeflowCommands(pi, config);
  };
}
