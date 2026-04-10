import { describe, expect, it } from "vitest";
import { resolveDatadogMcpTool } from "./mcp.js";

describe("resolveDatadogMcpTool", () => {
  it("prefers exact alias matches", () => {
    const session = {
      toolNames: ["get_datadog_metric", "search_datadog_logs"],
      tools: [
        { name: "get_datadog_metric", description: "Get a Datadog metric timeseries" },
        { name: "search_datadog_logs", description: "Search Datadog logs" },
      ],
    };

    expect(resolveDatadogMcpTool(session, "metricsQuery")).toBe("get_datadog_metric");
    expect(resolveDatadogMcpTool(session, "logsSearch")).toBe("search_datadog_logs");
  });

  it("falls back to tool descriptions when names differ", () => {
    const session = {
      toolNames: ["datadog_timeseries", "datadog_log_explorer"],
      tools: [
        { name: "datadog_timeseries", description: "Query metric timeseries and return datapoints" },
        { name: "datadog_log_explorer", description: "Search logs in Datadog log explorer" },
      ],
    };

    expect(resolveDatadogMcpTool(session, "metricsQuery")).toBe("datadog_timeseries");
    expect(resolveDatadogMcpTool(session, "logsSearch")).toBe("datadog_log_explorer");
  });
});
