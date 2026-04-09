import { getRegisteredCommandHandler, mockPi } from "@callumvass/forgeflow-shared/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerDatadogCommands } from "./commands.js";

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("registerDatadogCommands", () => {
  it("registers login, status, logout, and prompt commands", () => {
    const pi = mockPi();
    registerDatadogCommands(pi as never);

    expect(getRegisteredCommandHandler(pi, "datadog-login")).toBeTypeOf("function");
    expect(getRegisteredCommandHandler(pi, "datadog-status")).toBeTypeOf("function");
    expect(getRegisteredCommandHandler(pi, "datadog-logout")).toBeTypeOf("function");
    expect(getRegisteredCommandHandler(pi, "datadog")).toBeTypeOf("function");
  });

  it("surfaces login results via ui notifications", async () => {
    const pi = mockPi();
    const loginFn = vi
      .fn()
      .mockResolvedValueOnce({ serverUrl: "https://example.com/mcp", toolNames: ["query-metrics", "search-logs"] })
      .mockResolvedValueOnce("Login failed");

    registerDatadogCommands(pi as never, { loginFn });
    const handler = getRegisteredCommandHandler(pi, "datadog-login");
    if (!handler) throw new Error("expected /datadog-login handler");

    const ctx = {
      ui: {
        setStatus: vi.fn(),
        setWidget: vi.fn(),
        notify: vi.fn(),
      },
    };

    await handler("", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Datadog MCP login complete: 2 tools available on https://example.com/mcp",
      "info",
    );

    await handler("", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith("Login failed", "error");
  });

  it("routes /datadog through the forgeflow tool and supports status/logout", async () => {
    const pi = mockPi();
    const statusFn = vi.fn().mockResolvedValue({
      configured: true,
      authenticated: false,
      serverUrl: "https://example.com/mcp",
      hasRefreshToken: false,
      tokenType: undefined,
    });
    const logoutFn = vi.fn().mockResolvedValue(undefined);

    registerDatadogCommands(pi as never, { statusFn, logoutFn });

    const datadogHandler = getRegisteredCommandHandler(pi, "datadog");
    const statusHandler = getRegisteredCommandHandler(pi, "datadog-status");
    const logoutHandler = getRegisteredCommandHandler(pi, "datadog-logout");
    if (!datadogHandler || !statusHandler || !logoutHandler) throw new Error("expected datadog handlers");

    const ctx = {
      ui: {
        input: vi.fn(async () => undefined),
        notify: vi.fn(),
      },
    };

    await datadogHandler("investigate why billing is slow", ctx);
    expect(pi.sendUserMessage).toHaveBeenCalledWith(
      'Call the forgeflow-dev tool now with these exact parameters: pipeline="datadog", prompt="investigate why billing is slow". Treat the prompt as an opaque Datadog investigation request.',
    );

    await datadogHandler("", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith("No Datadog prompt provided.", "error");

    await statusHandler("", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Datadog MCP configured for https://example.com/mcp, but no login is stored. Run /datadog-login.",
      "warning",
    );

    await logoutHandler("", ctx);
    expect(logoutFn).toHaveBeenCalled();
    expect(ctx.ui.notify).toHaveBeenCalledWith("Datadog MCP login removed.", "info");
  });
});
