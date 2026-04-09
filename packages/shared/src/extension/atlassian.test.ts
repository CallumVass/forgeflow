import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockPi } from "../test-utils.js";
import { registerAtlassianCommands } from "./atlassian.js";
import { resetAtlassianCommandRegistry } from "./registry.js";

beforeEach(() => {
  resetAtlassianCommandRegistry();
});

describe("registerAtlassianCommands", () => {
  it("registers /atlassian-login exactly once across multiple forgeflow extensions", () => {
    const piA = mockPi();
    const piB = mockPi();

    registerAtlassianCommands(piA as never);
    registerAtlassianCommands(piB as never);

    expect(piA.registerCommand.mock.calls.filter((call: unknown[]) => call[0] === "atlassian-login")).toHaveLength(1);
    expect(piB.registerCommand.mock.calls.filter((call: unknown[]) => call[0] === "atlassian-login")).toHaveLength(0);
  });

  it("surfaces login success and failure via the ui callbacks", async () => {
    const pi = mockPi();
    const loginFn = vi
      .fn()
      .mockResolvedValueOnce({
        resources: [{ id: "1", url: "https://example.atlassian.net", name: "Example", scopes: [] }],
      })
      .mockResolvedValueOnce("No Atlassian OAuth app configured.");

    registerAtlassianCommands(pi as never, { loginFn });

    const call = pi.registerCommand.mock.calls.find((entry: unknown[]) => entry[0] === "atlassian-login");
    if (!call) throw new Error("expected /atlassian-login to be registered");
    const handler = (
      call[1] as {
        handler: (
          args: string,
          ctx: {
            ui: {
              setStatus: (id: string, text?: string) => void;
              setWidget: (id: string, lines?: string[]) => void;
              notify: (message: string, kind: string) => void;
            };
          },
        ) => Promise<void>;
      }
    ).handler;

    const ctx = {
      ui: {
        setStatus: vi.fn(),
        setWidget: vi.fn(),
        notify: vi.fn(),
      },
    };

    await handler("", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith("Atlassian login complete: Example", "info");

    await handler("", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith("No Atlassian OAuth app configured.", "error");
  });
});
