import {
  clearDatadogMcpOauthState,
  type DatadogMcpLoginResult,
  getDatadogMcpAuthStatus,
  loginWithDatadogMcpOauth,
} from "@callumvass/forgeflow-shared/datadog";
import { buildSendMessage } from "@callumvass/forgeflow-shared/extension";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

interface DatadogCommandDeps {
  loginFn?: typeof loginWithDatadogMcpOauth;
  statusFn?: typeof getDatadogMcpAuthStatus;
  logoutFn?: typeof clearDatadogMcpOauthState;
}

function summariseLogin(result: DatadogMcpLoginResult): string {
  const toolSummary = result.toolNames.length > 0 ? `${result.toolNames.length} tools available` : "no tools reported";
  return `Datadog MCP login complete: ${toolSummary} on ${result.serverUrl}`;
}

export function registerDatadogCommands(pi: ExtensionAPI, deps: DatadogCommandDeps = {}): void {
  pi.registerCommand("datadog-login", {
    description: "Authenticate forgeflow to an OAuth-enabled Datadog MCP server",
    handler: async (_args, ctx) => {
      const widgetId = "forgeflow-datadog";
      const setStatus = (text?: string) => ctx.ui.setStatus(widgetId, text);
      const setWidget = (lines?: string[]) => ctx.ui.setWidget(widgetId, lines);

      setStatus("Starting Datadog MCP OAuth...");
      setWidget(["Waiting for Datadog MCP OAuth..."]);

      const result = await (deps.loginFn ?? loginWithDatadogMcpOauth)({
        onStatus: (text) => setStatus(text),
        onAuthUrl: (url) => setWidget(["Copy this Datadog MCP OAuth URL into your browser:", url]),
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

  pi.registerCommand("datadog-status", {
    description: "Show Datadog MCP authentication status",
    handler: async (_args, ctx) => {
      const result = await (deps.statusFn ?? getDatadogMcpAuthStatus)();
      if (typeof result === "string") {
        ctx.ui.notify(result, "error");
        return;
      }

      const summary = result.authenticated
        ? `Datadog MCP connected to ${result.serverUrl} (${result.tokenType ?? "token"}).`
        : `Datadog MCP configured for ${result.serverUrl}, but no login is stored. Run /datadog-login.`;
      ctx.ui.notify(summary, result.authenticated ? "info" : "warning");
    },
  });

  pi.registerCommand("datadog-logout", {
    description: "Remove stored Datadog MCP OAuth credentials",
    handler: async (_args, ctx) => {
      await (deps.logoutFn ?? clearDatadogMcpOauthState)();
      ctx.ui.notify("Datadog MCP login removed.", "info");
    },
  });

  pi.registerCommand("datadog", {
    description: "Investigate Datadog runtime issues from a freeform prompt",
    handler: async (args, ctx) => {
      let prompt = args.trim();
      if (!prompt) {
        const input = await ctx.ui.input("Datadog prompt?", "e.g. investigate why the billing lambda is slow in prod");
        prompt = input?.trim() ?? "";
      }
      if (!prompt) {
        ctx.ui.notify("No Datadog prompt provided.", "error");
        return;
      }

      pi.sendUserMessage(
        buildSendMessage(
          "forgeflow-dev",
          "datadog",
          { prompt },
          "Treat the prompt as an opaque Datadog investigation request.",
        ),
      );
    },
  });
}
