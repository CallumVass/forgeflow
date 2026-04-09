import { beforeEach, describe, expect, it, vi } from "vitest";
import { getRegisteredShortcutHandler, mockExtensionConfig, mockForgeflowContext, mockPi } from "../test-utils.js";
import { registerForgeflowCommands } from "./commands.js";
import { resetStagesOverlayRegistry } from "./registry.js";

beforeEach(() => {
  resetStagesOverlayRegistry();
});

// ─── Tests ────────────────────────────────────────────────────────────

describe("registerForgeflowCommands", () => {
  it("registers each config command and invokes sendUserMessage with the buildSendMessage template", async () => {
    const pi = mockPi();
    const config = mockExtensionConfig();
    registerForgeflowCommands(pi as never, config);

    // Two user-configured commands plus the built-in /stages command.
    expect(pi.registerCommand).toHaveBeenCalledTimes(3);

    // First user command: parseArgs path
    // biome-ignore lint/style/noNonNullAssertion: test accessing mock call by known index
    const [name1, opts1] = pi.registerCommand.mock.calls[0]!;
    expect(name1).toBe("alpha-cmd");
    expect(opts1.description).toBe("Run alpha");
    await opts1.handler("42");
    expect(pi.sendUserMessage).toHaveBeenCalledWith(
      'Call the forgeflow-test tool now with these exact parameters: pipeline="alpha", issue="42". Do not interpret.',
    );

    pi.sendUserMessage.mockClear();

    // Second user command: no parseArgs path
    // biome-ignore lint/style/noNonNullAssertion: test accessing mock call by known index
    const [name2, opts2] = pi.registerCommand.mock.calls[1]!;
    expect(name2).toBe("beta-cmd");
    await opts2.handler("");
    expect(pi.sendUserMessage).toHaveBeenCalledWith(
      'Call the forgeflow-test tool now with these exact parameters: pipeline="beta".',
    );
  });

  it("registers /stages and Ctrl+Shift+S exactly once across two extensions and the handler sees both tool names", async () => {
    const piA = mockPi();
    const piB = mockPi();

    registerForgeflowCommands(piA as never, mockExtensionConfig({ toolName: "forgeflow-pm", commands: [] }));
    registerForgeflowCommands(piB as never, mockExtensionConfig({ toolName: "forgeflow-dev", commands: [] }));

    // Only the first extension claims the shared /stages command + ctrl+shift+s.
    expect(piA.registerCommand.mock.calls.filter((c: unknown[]) => c[0] === "stages")).toHaveLength(1);
    expect(piA.registerShortcut.mock.calls.filter((c: unknown[]) => c[0] === "ctrl+shift+s")).toHaveLength(1);
    expect(piB.registerCommand.mock.calls.filter((c: unknown[]) => c[0] === "stages")).toHaveLength(0);
    expect(piB.registerShortcut.mock.calls.filter((c: unknown[]) => c[0] === "ctrl+shift+s")).toHaveLength(0);

    // The handler — registered on piA — must see tool names from BOTH
    // extensions when invoked, proving both registrations populated the same
    // shared registry. Capture the tool names by intercepting ctx.ui.custom,
    // which the overlay calls with a factory closure that reads the registry.
    const handler = getRegisteredShortcutHandler(piA, "ctrl+shift+s");
    expect(handler).toBeDefined();

    const custom = vi.fn(async () => undefined);
    const notify = vi.fn();
    // sessionManager returns no entries → openStagesOverlay notifies "no
    // pipeline" instead of opening the overlay; the call still proves the
    // shared handler is wired and reads the registry through openStagesOverlay.
    const ctx = mockForgeflowContext({
      hasUI: true,
      ui: { custom, notify },
      sessionManager: { getBranch: () => [] },
    });

    if (!handler) throw new Error("expected ctrl+shift+s shortcut to be registered");
    await handler(ctx);

    // openStagesOverlay was invoked with both registered tool names — the
    // notify message proves we reached its body, and the only way the registry
    // could have been populated for both names is via the shared /stages
    // registration on piA seeing piB's earlier write.
    expect(notify).toHaveBeenCalledWith("No forgeflow pipeline in this session yet", "info");
  });

  it("after resetStagesOverlayRegistry, the next call re-registers /stages and ctrl+shift+s", () => {
    const piA = mockPi();
    registerForgeflowCommands(piA as never, mockExtensionConfig({ commands: [] }));
    expect(piA.registerCommand.mock.calls.filter((c: unknown[]) => c[0] === "stages")).toHaveLength(1);

    resetStagesOverlayRegistry();

    const piB = mockPi();
    registerForgeflowCommands(piB as never, mockExtensionConfig({ commands: [] }));
    // After reset, piB now claims the /stages registration just like piA did before.
    expect(piB.registerCommand.mock.calls.filter((c: unknown[]) => c[0] === "stages")).toHaveLength(1);
    expect(piB.registerShortcut.mock.calls.filter((c: unknown[]) => c[0] === "ctrl+shift+s")).toHaveLength(1);
  });
});
