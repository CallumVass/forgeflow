import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { describe, expect, it, vi } from "vitest";
import { setupIsolatedHomeFixture } from "../../testing/index.js";
import { getMcpOauthStatePath, writeMcpOauthState } from "../auth/state.js";
import { connectMcpSession, withMcpSession } from "./index.js";

const fixture = setupIsolatedHomeFixture("mcp-session");
const config = {
  serverUrl: "https://example.com/mcp",
  redirectUri: "http://127.0.0.1:33389/callback",
  clientName: "Test MCP",
};
const options = {
  serviceLabel: "Test MCP",
  loginCommand: "test-login",
  sessionClientName: "test-mcp-session",
};

describe("connectMcpSession", () => {
  it("returns login guidance when no token is stored", async () => {
    const statePath = getMcpOauthStatePath("session-missing-token");

    await expect(connectMcpSession(config, statePath, options)).resolves.toBe(
      "Test MCP is configured but no login was found. Run /test-login.",
    );

    expect(statePath.startsWith(fixture.homeDir)).toBe(true);
  });

  it("returns reauthorisation guidance after UnauthorizedError and closes the transport", async () => {
    const statePath = getMcpOauthStatePath("session-unauthorised");
    await writeMcpOauthState(statePath, {
      tokens: { access_token: "token", token_type: "Bearer" },
    });

    const close = vi.fn().mockResolvedValue(undefined);
    const result = await connectMcpSession(config, statePath, options, {
      createClientFn: () => ({
        connect: async () => {
          throw new UnauthorizedError();
        },
        listTools: async () => ({ tools: [] }),
        callTool: async () => ({ ok: true }),
      }),
      createTransportFn: () =>
        ({
          start: vi.fn().mockResolvedValue(undefined),
          send: vi.fn().mockResolvedValue(undefined),
          close,
        }) as never,
    });

    expect(result).toBe("Test MCP authorisation has expired or is missing. Run /test-login.");
    expect(close).toHaveBeenCalled();
  });
});

describe("withMcpSession", () => {
  it("always closes the transport after success and callback errors", async () => {
    const statePath = getMcpOauthStatePath("session-close");
    await writeMcpOauthState(statePath, {
      tokens: { access_token: "token", token_type: "Bearer" },
    });

    const firstClose = vi.fn().mockResolvedValue(undefined);
    const secondClose = vi.fn().mockResolvedValue(undefined);
    const makeDeps = (close: typeof firstClose) => ({
      createClientFn: () => ({
        connect: vi.fn().mockResolvedValue(undefined),
        listTools: async () => ({ tools: [{ name: "b" }, { name: "a" }] }),
        callTool: async () => ({ ok: true }),
      }),
      createTransportFn: () =>
        ({
          start: vi.fn().mockResolvedValue(undefined),
          send: vi.fn().mockResolvedValue(undefined),
          close,
        }) as never,
    });

    await expect(
      withMcpSession(config, statePath, options, async (session) => session.toolNames, makeDeps(firstClose)),
    ).resolves.toEqual(["a", "b"]);
    expect(firstClose).toHaveBeenCalled();

    await expect(
      withMcpSession(
        config,
        statePath,
        options,
        async () => {
          throw new Error("boom");
        },
        makeDeps(secondClose),
      ),
    ).rejects.toThrow(/boom/);
    expect(secondClose).toHaveBeenCalled();
  });
});
