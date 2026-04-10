import { beforeEach, describe, expect, it, vi } from "vitest";
import { getRegisteredCommandHandler, mockPi } from "../test-utils.js";
import { registerAtlassianCommands } from "./atlassian.js";
import { resetAtlassianCommandRegistry } from "./registry.js";

beforeEach(() => {
  resetAtlassianCommandRegistry();
});

describe("registerAtlassianCommands", () => {
  it("registers /atlassian-login, /atlassian-status, /atlassian-logout, and /atlassian-read exactly once across multiple forgeflow extensions", () => {
    const piA = mockPi();
    const piB = mockPi();

    registerAtlassianCommands(piA as never, { toolName: "forgeflow-dev" });
    registerAtlassianCommands(piB as never, { toolName: "forgeflow-pm" });

    expect(piA.registerCommand.mock.calls.filter((call: unknown[]) => call[0] === "atlassian-login")).toHaveLength(1);
    expect(piB.registerCommand.mock.calls.filter((call: unknown[]) => call[0] === "atlassian-login")).toHaveLength(0);
    expect(piA.registerCommand.mock.calls.filter((call: unknown[]) => call[0] === "atlassian-status")).toHaveLength(1);
    expect(piB.registerCommand.mock.calls.filter((call: unknown[]) => call[0] === "atlassian-status")).toHaveLength(0);
    expect(piA.registerCommand.mock.calls.filter((call: unknown[]) => call[0] === "atlassian-logout")).toHaveLength(1);
    expect(piB.registerCommand.mock.calls.filter((call: unknown[]) => call[0] === "atlassian-logout")).toHaveLength(0);
    expect(piA.registerCommand.mock.calls.filter((call: unknown[]) => call[0] === "atlassian-read")).toHaveLength(1);
    expect(piB.registerCommand.mock.calls.filter((call: unknown[]) => call[0] === "atlassian-read")).toHaveLength(0);
  });

  it("surfaces login results via the ui callbacks", async () => {
    const pi = mockPi();
    const loginFn = vi
      .fn()
      .mockResolvedValueOnce({
        serverUrl: "https://example.com/mcp",
        toolNames: ["get-jira-issue", "get-confluence-page"],
      })
      .mockResolvedValueOnce("No Atlassian MCP server configured.");

    registerAtlassianCommands(pi as never, { loginFn, toolName: "forgeflow-dev" });

    const handler = getRegisteredCommandHandler(pi, "atlassian-login");
    if (!handler) throw new Error("expected /atlassian-login to be registered");

    const ctx = {
      ui: {
        setStatus: vi.fn(),
        setWidget: vi.fn(),
        notify: vi.fn(),
      },
    };

    await handler("", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Atlassian MCP login complete: 2 tools available on https://example.com/mcp",
      "info",
    );

    await handler("", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith("No Atlassian MCP server configured.", "error");
  });

  it("routes /atlassian-read through the configured forgeflow tool and supports status/logout", async () => {
    const pi = mockPi();
    const statusFn = vi.fn().mockResolvedValue({
      configured: true,
      authenticated: false,
      serverUrl: "https://example.com/mcp",
      hasRefreshToken: false,
      tokenType: undefined,
    });
    const logoutFn = vi.fn().mockResolvedValue(undefined);

    registerAtlassianCommands(pi as never, { toolName: "forgeflow-pm", statusFn, logoutFn });

    const readHandler = getRegisteredCommandHandler(pi, "atlassian-read");
    const statusHandler = getRegisteredCommandHandler(pi, "atlassian-status");
    const logoutHandler = getRegisteredCommandHandler(pi, "atlassian-logout");
    if (!readHandler || !statusHandler || !logoutHandler) throw new Error("expected Atlassian handlers");

    const ctx = {
      ui: {
        input: vi.fn(async () => undefined),
        notify: vi.fn(),
      },
    };

    await readHandler("https://example.atlassian.net/browse/PROJ-7", ctx);
    expect(pi.sendUserMessage).toHaveBeenCalledWith(
      'Call the forgeflow-pm tool now with these exact parameters: pipeline="atlassian-read", url="https://example.atlassian.net/browse/PROJ-7".',
    );

    await readHandler("", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith("No Atlassian URL provided.", "error");

    await statusHandler("", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Atlassian MCP configured for https://example.com/mcp, but no login is stored. Run /atlassian-login.",
      "warning",
    );

    await logoutHandler("", ctx);
    expect(logoutFn).toHaveBeenCalled();
    expect(ctx.ui.notify).toHaveBeenCalledWith("Atlassian MCP login removed.", "info");
  });
});
