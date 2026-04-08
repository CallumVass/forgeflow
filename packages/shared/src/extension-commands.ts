import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { buildSendMessage } from "./extension-message.js";
import { getStagesOverlayRegistry } from "./extension-registry.js";
import type { ExtensionConfig } from "./extension-types.js";
import type { ForgeflowContext } from "./pipeline.js";
import { openStagesOverlay } from "./stages-overlay.js";

// ─── pi.registerCommand wiring + shared /stages overlay ──────────────

/**
 * Register every user-defined command from `config.commands` and, exactly
 * once per process across all forgeflow extensions, register the `/stages`
 * command and `Ctrl+Shift+S` shortcut that open the shared stages overlay.
 *
 * The overlay handlers read tool names from the process-wide stages-overlay
 * registry, so any forgeflow extension that loads later still has its tool
 * name considered when the overlay opens.
 */
export function registerForgeflowCommands(pi: ExtensionAPI, config: ExtensionConfig): void {
  for (const cmd of config.commands) {
    pi.registerCommand(cmd.name, {
      description: cmd.description,
      handler: async (args) => {
        const { params, suffix } = cmd.parseArgs?.(args) ?? {};
        pi.sendUserMessage(buildSendMessage(config.toolName, cmd.pipeline, params ?? {}, suffix));
      },
    });
  }

  // Stage drill-down overlay: `/stages` command + Ctrl+Shift+S shortcut.
  //
  // Both are registered exactly once per process across all forgeflow
  // extensions. The handlers read the shared registry of tool names so the
  // overlay covers every forgeflow tool that has loaded by the time the user
  // invokes it.
  const registry = getStagesOverlayRegistry();
  registry.toolNames.add(config.toolName);
  if (!registry.registered) {
    registry.registered = true;
    const openOverlay = async (ctx: ForgeflowContext) => {
      await openStagesOverlay(ctx, Array.from(registry.toolNames));
    };
    pi.registerCommand("stages", {
      description: "Drill into the most recent forgeflow pipeline stages",
      handler: async (_args, ctx) => {
        await openOverlay(ctx as unknown as ForgeflowContext);
      },
    });
    pi.registerShortcut("ctrl+shift+s", {
      description: "Open forgeflow stages overlay",
      handler: async (ctx) => {
        await openOverlay(ctx as unknown as ForgeflowContext);
      },
    });
  }
}
