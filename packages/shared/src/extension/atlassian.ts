import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  type AtlassianMcpLoginResult,
  clearAtlassianMcpOauthState,
  getAtlassianMcpAuthStatus,
  loginWithAtlassianMcpOauth,
} from "../atlassian/index.js";
import { buildSendMessage } from "./message.js";
import { getAtlassianCommandRegistry } from "./registry.js";

interface AtlassianCommandDeps {
  loginFn?: typeof loginWithAtlassianMcpOauth;
  statusFn?: typeof getAtlassianMcpAuthStatus;
  logoutFn?: typeof clearAtlassianMcpOauthState;
  toolName?: string;
}

function summariseLogin(result: AtlassianMcpLoginResult): string {
  const toolSummary = result.toolNames.length > 0 ? `${result.toolNames.length} tools available` : "no tools reported";
  return `Atlassian MCP login complete: ${toolSummary} on ${result.serverUrl}`;
}

export function registerAtlassianCommands(pi: ExtensionAPI, deps: AtlassianCommandDeps = {}): void {
  const registry = getAtlassianCommandRegistry();
  if (registry.registered) return;
  registry.registered = true;

  pi.registerCommand("atlassian-login", {
    description: "Authenticate forgeflow to an OAuth-enabled Atlassian MCP server",
    handler: async (_args, ctx) => {
      const widgetId = "forgeflow-atlassian";
      const setStatus = (text?: string) => ctx.ui.setStatus(widgetId, text);
      const setWidget = (lines?: string[]) => ctx.ui.setWidget(widgetId, lines);

      setStatus("Starting Atlassian MCP OAuth...");
      setWidget(["Waiting for Atlassian MCP OAuth..."]);

      const result = await (deps.loginFn ?? loginWithAtlassianMcpOauth)({
        onStatus: (text) => setStatus(text),
        onAuthUrl: (url) => {
          setWidget(["Copy this Atlassian MCP OAuth URL into your browser:", url]);
        },
      });

      setStatus(undefined);
      setWidget(undefined);

      if (typeof result === "string") {
        ctx.ui.notify(result, "error");
        return;
      }

      ctx.ui.notify(summariseLogin(result), "info");
    },
  });

  pi.registerCommand("atlassian-status", {
    description: "Show Atlassian MCP authentication status",
    handler: async (_args, ctx) => {
      const result = await (deps.statusFn ?? getAtlassianMcpAuthStatus)();
      if (typeof result === "string") {
        ctx.ui.notify(result, "error");
        return;
      }

      const summary = result.authenticated
        ? `Atlassian MCP connected to ${result.serverUrl} (${result.tokenType ?? "token"}).`
        : `Atlassian MCP configured for ${result.serverUrl}, but no login is stored. Run /atlassian-login.`;
      ctx.ui.notify(summary, result.authenticated ? "info" : "warning");
    },
  });

  pi.registerCommand("atlassian-logout", {
    description: "Remove stored Atlassian MCP OAuth credentials",
    handler: async (_args, ctx) => {
      await (deps.logoutFn ?? clearAtlassianMcpOauthState)();
      ctx.ui.notify("Atlassian MCP login removed.", "info");
    },
  });

  pi.registerCommand("atlassian-read", {
    description: "Read a Jira issue or Confluence page by URL via Atlassian MCP",
    handler: async (args, ctx) => {
      let url = args.trim();
      if (!url) {
        const input = await ctx.ui.input("Atlassian URL?", "Paste Jira or Confluence URL");
        url = input?.trim() ?? "";
      }
      if (!url) {
        ctx.ui.notify("No Atlassian URL provided.", "error");
        return;
      }

      pi.sendUserMessage(buildSendMessage(deps.toolName ?? "forgeflow-dev", "atlassian-read", { url }));
    },
  });
}
