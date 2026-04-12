import type { McpService } from "../mcp/index.js";
import { createMcpService } from "../mcp/index.js";
import { getDatadogMcpConfig } from "./oauth.js";

export const datadogMcpService: McpService = createMcpService({
  integration: "datadog",
  serviceLabel: "Datadog MCP",
  loginCommand: "datadog-login",
  loginClientName: "forgeflow-datadog-login",
  sessionClientName: "forgeflow-datadog-mcp",
  getConfig: () => getDatadogMcpConfig(),
});
