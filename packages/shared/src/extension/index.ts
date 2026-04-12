import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerForgeflowCommands } from "./commands.js";
import { buildSchema } from "./schema.js";
import { registerForgeflowTool } from "./tool.js";
import type { ExtensionConfig } from "./types.js";

// ─── Public re-exports ───────────────────────────────────────────────
//
// Consumers (`forgeflow-pm`, `forgeflow-dev`, and any external extension)
// import everything they need from `@callumvass/forgeflow-shared/extension`,
// so this module is the single public entry point. The implementation lives
// in sibling modules (`extension-types`, `extension-message`,
// `extension-schema`, `extension-registry`, `extension-tool`,
// `extension-commands`) but none of those are published.

export { registerAtlassianCommands } from "./atlassian.js";
export { buildSendMessage } from "./message.js";
export type {
  CommandAutocompleteItem,
  CommandDefinition,
  CommandExecResult,
  CommandHelpers,
  CommandInvocation,
  ExtensionConfig,
  ParamDef,
  PipelineDefinition,
  PostRunActionHelpers,
} from "./types.js";

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
