import type { DatadogMcpSession } from "@callumvass/forgeflow-shared/datadog";
import { describe, expect, it, vi } from "vitest";
import type { MetricQueryPlan } from "./contracts.js";

const mocks = vi.hoisted(() => ({
  callDatadogMcpTool: vi.fn(),
}));

vi.mock("@callumvass/forgeflow-shared/datadog", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    callDatadogMcpTool: mocks.callDatadogMcpTool,
  };
});

import { fetchErrorLogs, fetchSpanSummary, fetchSummary } from "./query-execution.js";

function mcpJson(value: unknown) {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
  };
}

function mcpText(text: string) {
  return {
    content: [{ type: "text", text }],
  };
}

describe("fetchSummary", () => {
  it("sends batched metric queries and parses wrapped Datadog payloads", async () => {
    const session = {
      toolNames: ["get_datadog_metric"],
      tools: [{ name: "get_datadog_metric", description: "Get Datadog metric timeseries" }],
    } as Pick<DatadogMcpSession, "toolNames" | "tools"> as DatadogMcpSession;
    const plan: MetricQueryPlan = {
      durationMetric: "galaxy_console.profile.duration",
      countMetric: "galaxy_console.profile.count",
      filters: [
        { key: "env", value: "prod" },
        { key: "lambda_function", value: "profilefetch" },
      ],
      score: 120,
      provenance: ["metric:galaxy_console.profile.duration"],
    };

    mocks.callDatadogMcpTool.mockImplementation(
      async (_session: unknown, tool: string, args: Record<string, unknown>) => {
        expect(tool).toBe("get_datadog_metric");
        expect(Array.isArray(args.queries)).toBe(true);
        const queries = (args.queries as string[]) ?? [];
        expect(queries).toContain("avg:galaxy_console.profile.duration{env:prod,lambda_function:profilefetch}");
        return mcpText(
          [
            "<METADATA>",
            "  <metrics_explorer_url>https://app.datadoghq.eu/metric/explorer</metrics_explorer_url>",
            "</METADATA>",
            "<JSON_DATA>",
            JSON.stringify(
              queries.map((expression) => {
                if (
                  expression.startsWith("sum:galaxy_console.profile.count") &&
                  expression.includes("result:failure")
                ) {
                  return { expression, overall_stats: { sum: 2 } };
                }
                if (expression.startsWith("sum:galaxy_console.profile.count")) {
                  return { expression, overall_stats: { sum: 12 } };
                }
                if (expression.startsWith("avg:")) return { expression, overall_stats: { avg: 4200 } };
                if (expression.startsWith("p95:")) return { expression, overall_stats: { avg: 7900 } };
                if (expression.startsWith("p99:")) return { expression, overall_stats: { avg: 10100 } };
                if (expression.startsWith("max:")) return { expression, overall_stats: { max: 12000 } };
                return { expression, overall_stats: {} };
              }),
            ),
            "</JSON_DATA>",
          ].join("\n"),
        );
      },
    );

    const summary = await fetchSummary(session, "get_datadog_metric", [plan], 24 * 60 * 60 * 1000);

    expect(summary?.percentiles.metric).toBe("galaxy_console.profile.duration");
    expect(summary?.requestCount).toBe(12);
    expect(summary?.failureCount).toBe(2);
    expect(summary?.percentiles.values.find((entry) => entry.label === "p95")?.value).toBe(7900);
  });

  it("falls back to legacy single-query metric calls when the batch response is unusable", async () => {
    const session = {
      toolNames: ["get_datadog_metric"],
      tools: [{ name: "get_datadog_metric", description: "Get Datadog metric timeseries" }],
    } as Pick<DatadogMcpSession, "toolNames" | "tools"> as DatadogMcpSession;
    const plan: MetricQueryPlan = {
      durationMetric: "aws.lambda.duration",
      filters: [{ key: "functionname", value: "profile-fetch-prod" }],
      score: 10,
      provenance: ["fallback functionname:profile-fetch-prod"],
    };

    mocks.callDatadogMcpTool.mockImplementation(
      async (_session: unknown, _tool: string, args: Record<string, unknown>) => {
        if (Array.isArray(args.queries)) return mcpJson([]);
        return mcpJson({ series: [{ points: [{ value: 2400 }] }] });
      },
    );

    const summary = await fetchSummary(session, "get_datadog_metric", [plan], 24 * 60 * 60 * 1000);

    expect(mocks.callDatadogMcpTool).toHaveBeenCalledTimes(7);
    expect(summary?.percentiles.metric).toBe("aws.lambda.duration");
    expect(summary?.requestCount).toBe(2400);
    expect(summary?.percentiles.values.find((entry) => entry.label === "avg")?.value).toBe(2400);
  });
});

describe("fetchErrorLogs", () => {
  it("aggregates recent error logs into counts and top messages", async () => {
    const session = {
      toolNames: ["search_datadog_logs"],
      tools: [{ name: "search_datadog_logs", description: "Search Datadog logs" }],
    } as Pick<DatadogMcpSession, "toolNames" | "tools"> as DatadogMcpSession;

    mocks.callDatadogMcpTool.mockResolvedValue(
      mcpJson({
        logs: [
          { message: "Downstream timeout\nfor dependency" },
          { message: "Downstream timeout for dependency" },
          { message: "Validation failed" },
        ],
      }),
    );

    const logs = await fetchErrorLogs(session, "search_datadog_logs", "env:prod status:error", 24 * 60 * 60 * 1000);

    expect(logs).toEqual({
      count: 3,
      topMessages: ["2× Downstream timeout for dependency", "1× Validation failed"],
    });
  });
});

describe("fetchSpanSummary", () => {
  it("falls back to span search and extracts duration statistics", async () => {
    const session = {
      toolNames: ["search_datadog_spans"],
      tools: [{ name: "search_datadog_spans", description: "Search Datadog spans" }],
    } as Pick<DatadogMcpSession, "toolNames" | "tools"> as DatadogMcpSession;

    mocks.callDatadogMcpTool.mockResolvedValue(
      mcpJson({ spans: [{ duration_ms: 2100 }, { duration_ns: 4_200_000_000 }, { duration: 6100 }] }),
    );

    const summary = await fetchSpanSummary(
      session,
      "search_datadog_spans",
      ["env:prod service:galaxy-console resource_name:*profile*fetch*"],
      24 * 60 * 60 * 1000,
    );

    expect(summary).toEqual({
      query: "env:prod service:galaxy-console resource_name:*profile*fetch*",
      count: 3,
      avgDurationMs: 4133.333333333333,
      p95DurationMs: 6100,
      maxDurationMs: 6100,
    });
  });
});
