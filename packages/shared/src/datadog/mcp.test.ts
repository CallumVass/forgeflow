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

  it("resolves metric context and spans search aliases and heuristics", () => {
    const aliasedSession = {
      toolNames: ["datadog_get_datadog_metric_context", "datadog_search_datadog_spans"],
      tools: [
        { name: "datadog_get_datadog_metric_context", description: "Get Datadog metric context" },
        { name: "datadog_search_datadog_spans", description: "Search Datadog spans" },
      ],
    };

    expect(resolveDatadogMcpTool(aliasedSession, "metricContext")).toBe("datadog_get_datadog_metric_context");
    expect(resolveDatadogMcpTool(aliasedSession, "spansSearch")).toBe("datadog_search_datadog_spans");

    const heuristicSession = {
      toolNames: ["metric_dimensions", "trace_explorer"],
      tools: [
        { name: "metric_dimensions", description: "Inspect metric context, indexed tags and metadata" },
        { name: "trace_explorer", description: "Search spans and trace data in APM" },
      ],
    };

    expect(resolveDatadogMcpTool(heuristicSession, "metricContext")).toBe("metric_dimensions");
    expect(resolveDatadogMcpTool(heuristicSession, "spansSearch")).toBe("trace_explorer");
  });
});
