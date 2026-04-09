import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { loginWithAtlassianOauth } from "../atlassian/index.js";
import { getAtlassianCommandRegistry } from "./registry.js";

interface AtlassianCommandDeps {
  loginFn?: typeof loginWithAtlassianOauth;
}

export function registerAtlassianCommands(pi: ExtensionAPI, deps: AtlassianCommandDeps = {}): void {
  const registry = getAtlassianCommandRegistry();
  if (registry.registered) return;
  registry.registered = true;

  pi.registerCommand("atlassian-login", {
    description: "Authenticate forgeflow to Atlassian via OAuth",
    handler: async (_args, ctx) => {
      const widgetId = "forgeflow-atlassian";
      const setStatus = (text?: string) => ctx.ui.setStatus(widgetId, text);
      const setWidget = (lines?: string[]) => ctx.ui.setWidget(widgetId, lines);

      setStatus("Starting Atlassian OAuth...");
      setWidget(["Waiting for Atlassian OAuth..."]);

      const result = await (deps.loginFn ?? loginWithAtlassianOauth)({
        onStatus: (text) => setStatus(text),
        onAuthUrl: (url) => {
          setWidget(["Open this Atlassian OAuth URL if your browser does not launch:", url]);
        },
      });

      setStatus(undefined);
      setWidget(undefined);

      if (typeof result === "string") {
        ctx.ui.notify(result, "error");
        return;
      }

      const sites = result.resources.map((resource) => resource.name).filter(Boolean);
      const summary = sites.length > 0 ? sites.join(", ") : "your Atlassian site";
      ctx.ui.notify(`Atlassian login complete: ${summary}`, "info");
    },
  });
}
