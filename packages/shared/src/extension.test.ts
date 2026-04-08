import { beforeEach, describe, expect, it } from "vitest";
import { createForgeflowExtension } from "./extension.js";
import { resetStagesOverlayRegistry } from "./extension-registry.js";
import { mockExtensionConfig, mockPi } from "./test-utils.js";

beforeEach(() => {
  resetStagesOverlayRegistry();
});

describe("createForgeflowExtension", () => {
  it("wires registerForgeflowTool and registerForgeflowCommands on the supplied pi", () => {
    const pi = mockPi();
    const config = mockExtensionConfig();

    createForgeflowExtension(config)(pi as never);

    // registerForgeflowTool fired exactly once with the configured name.
    expect(pi.registerTool).toHaveBeenCalledTimes(1);
    // biome-ignore lint/style/noNonNullAssertion: test accessing known mock call index
    expect(pi.registerTool.mock.calls[0]![0]!.name).toBe("forgeflow-test");

    // registerForgeflowCommands fired for each user command plus the shared
    // /stages overlay command (2 user + 1 stages = 3).
    expect(pi.registerCommand).toHaveBeenCalledTimes(3);
    const commandNames = pi.registerCommand.mock.calls.map((c: unknown[]) => c[0]);
    expect(commandNames).toContain("alpha-cmd");
    expect(commandNames).toContain("beta-cmd");
    expect(commandNames).toContain("stages");
  });
});
