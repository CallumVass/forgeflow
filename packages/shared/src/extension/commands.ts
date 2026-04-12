import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { openStagesOverlay } from "../render/index.js";
import type { ForgeflowContext } from "../runtime/index.js";
import { buildSendMessage } from "./message.js";
import { getStagesOverlayRegistry } from "./registry.js";
import type { ExtensionConfig } from "./types.js";

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
    const getArgumentCompletions = cmd.getArgumentCompletions;
    pi.registerCommand(cmd.name, {
      description: cmd.description,
      getArgumentCompletions: getArgumentCompletions ? (prefix) => getArgumentCompletions(prefix) ?? null : undefined,
      handler: async (args, ctx) => {
        let invocation = cmd.parseArgs?.(args) ?? {};
        if (!args.trim() && cmd.launch && ctx.hasUI) {
          const launched = await cmd.launch(ctx as unknown as ForgeflowContext, {
            exec: (command, argv = [], options) => pi.exec(command, argv, options),
          });
          if (!launched) return;
          invocation = launched;
        }
        const params = (invocation.params ?? {}) as Record<string, unknown>;
        config.onCommandInvoked?.(cmd.name, params);
        pi.appendEntry("forgeflow-command", { toolName: config.toolName, command: cmd.name, params });
        pi.sendUserMessage(
          buildSendMessage(
            config.toolName,
            cmd.pipeline,
            params as Record<string, string | number | boolean | undefined>,
            invocation.suffix,
          ),
        );
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
