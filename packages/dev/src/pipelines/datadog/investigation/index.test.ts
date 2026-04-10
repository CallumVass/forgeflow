import type { DatadogMcpSession } from "@callumvass/forgeflow-shared/datadog";
import { mockPipelineContext } from "@callumvass/forgeflow-shared/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LambdaCandidate } from "../candidate.js";
import { parseDatadogRequest } from "../request.js";

const mocks = vi.hoisted(() => ({
  withDatadogMcpSession: vi.fn(),
  callDatadogMcpTool: vi.fn(),
}));

vi.mock("@callumvass/forgeflow-shared/datadog", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    withDatadogMcpSession: mocks.withDatadogMcpSession,
    callDatadogMcpTool: mocks.callDatadogMcpTool,
  };
});

import { runDatadogInvestigation } from "./index.js";

function mcpJson(value: unknown) {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
  };
}

describe("runDatadogInvestigation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns the existing metric performance report", async () => {
    const session = {
      toolNames: ["get_datadog_metric", "search_datadog_metrics", "get_datadog_metric_context", "search_datadog_logs"],
      tools: [
        { name: "get_datadog_metric", description: "Get Datadog metric timeseries" },
        { name: "search_datadog_metrics", description: "Search Datadog metrics" },
        { name: "get_datadog_metric_context", description: "Get metric context including indexed tags" },
        { name: "search_datadog_logs", description: "Search Datadog logs" },
      ],
    } as Pick<DatadogMcpSession, "toolNames" | "tools"> as DatadogMcpSession;
    const candidate: LambdaCandidate = {
      file: "infra/lambda.ts",
      line: 42,
      constructId: "ProfileFetch",
      score: 1,
      reasons: [],
    };

    mocks.withDatadogMcpSession.mockImplementation(async (fn: (sessionArg: DatadogMcpSession) => Promise<unknown>) =>
      fn(session),
    );
    mocks.callDatadogMcpTool.mockImplementation(
      async (_session: unknown, tool: string, args: Record<string, unknown>) => {
        if (tool === "search_datadog_metrics")
          return mcpJson(["galaxy_console.profile.duration", "galaxy_console.profile.count"]);
        if (tool === "get_datadog_metric_context") {
          return mcpJson({
            metric_name: String(args.metric_name),
            tags_data: {
              indexed_tags: {
                env: ["prod"],
                lambda_function: ["profilefetch"],
                result: ["success", "failure"],
              },
            },
          });
        }
        if (tool === "get_datadog_metric") {
          const queries = (args.queries as string[]) ?? [];
          return mcpJson(
            queries.map((expression) => {
              if (expression.startsWith("sum:galaxy_console.profile.count") && expression.includes("result:failure")) {
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
          );
        }
        if (tool === "search_datadog_logs") return mcpJson({ logs: [{ message: "Downstream timeout" }] });
        return mcpJson({});
      },
    );

    const pctx = mockPipelineContext({
      cwd: "/tmp/project",
      execSafeFn: vi.fn(async () => ["galaxy_console.profile.duration", "galaxy_console.profile.count"].join("\n")),
    });

    const result = await runDatadogInvestigation({
      prompt: "tell me how the profile fetch lambda is performing in prod",
      request: parseDatadogRequest("tell me how the profile fetch lambda is performing in prod"),
      candidate,
      pctx,
    });

    expect(result.report).toContain("Metric used: galaxy_console.profile.duration");
    expect(result.report).toContain("Filters used: env:prod, lambda_function:profilefetch");
    expect(result.report).toContain("Request count: 12");
    expect(result.report).toContain("Failure count: 2 (16.7%)");
    expect(result.report).toContain("- p95: 7.90 s");
    expect(result.isError).toBeUndefined();
  });

  it("uses the best discovered Lambda filters for log search when metrics are sparse", async () => {
    const session = {
      toolNames: ["get_datadog_metric", "get_datadog_metric_context", "search_datadog_logs"],
      tools: [
        { name: "get_datadog_metric", description: "Get Datadog metric timeseries" },
        { name: "get_datadog_metric_context", description: "Get metric context including indexed tags" },
        { name: "search_datadog_logs", description: "Search Datadog logs" },
      ],
    } as Pick<DatadogMcpSession, "toolNames" | "tools"> as DatadogMcpSession;
    const candidate: LambdaCandidate = {
      file: "infra/lambda.ts",
      line: 42,
      constructId: "ProfileFetch",
      score: 1,
      reasons: [],
    };

    mocks.withDatadogMcpSession.mockImplementation(async (fn: (sessionArg: DatadogMcpSession) => Promise<unknown>) =>
      fn(session),
    );
    mocks.callDatadogMcpTool.mockImplementation(
      async (_session: unknown, tool: string, args: Record<string, unknown>) => {
        if (tool === "get_datadog_metric") return mcpJson([]);
        if (tool === "get_datadog_metric_context") {
          return mcpJson({
            metric_name: String(args.metric_name),
            tags_data: {
              indexed_tags: {
                env: ["prod"],
                functionname: ["prod-galaxy-profilefetch-a1b2c3"],
              },
            },
          });
        }
        if (tool === "search_datadog_logs") {
          expect(String(args.query)).toContain("functionname:prod-galaxy-profilefetch-a1b2c3");
          expect(String(args.query)).toContain("status:error");
          return mcpJson({ logs: [] });
        }
        return mcpJson({});
      },
    );

    const pctx = mockPipelineContext({ cwd: "/tmp/project", execSafeFn: vi.fn(async () => "aws.lambda.duration") });

    const result = await runDatadogInvestigation({
      prompt: "investigate the profile fetch lambda in prod",
      request: parseDatadogRequest("investigate the profile fetch lambda in prod"),
      candidate,
      pctx,
    });

    expect(result.report).toContain(
      "Recent error logs:\n- No recent error logs matched the resolved Lambda name/tags.",
    );
    expect(result.isError).toBeUndefined();
  });

  it("falls back to traces for sparse metrics and preserves the no-log-match message", async () => {
    const session = {
      toolNames: ["get_datadog_metric", "get_datadog_metric_context", "search_datadog_spans", "search_datadog_logs"],
      tools: [
        { name: "get_datadog_metric", description: "Get Datadog metric timeseries" },
        { name: "get_datadog_metric_context", description: "Get metric context including indexed tags" },
        { name: "search_datadog_spans", description: "Search Datadog spans" },
        { name: "search_datadog_logs", description: "Search Datadog logs" },
      ],
    } as Pick<DatadogMcpSession, "toolNames" | "tools"> as DatadogMcpSession;
    const profileCandidate: LambdaCandidate = {
      file: "infra/lambda.ts",
      line: 42,
      constructId: "ProfileFetch",
      score: 1,
      reasons: [],
    };
    const invoiceCandidate: LambdaCandidate = {
      file: "infra/lambda.ts",
      line: 45,
      functionName: "invoice-prod",
      constructId: "InvoiceLambda",
      score: 1,
      reasons: [],
    };

    mocks.withDatadogMcpSession.mockImplementation(async (fn: (sessionArg: DatadogMcpSession) => Promise<unknown>) =>
      fn(session),
    );
    mocks.callDatadogMcpTool.mockImplementation(
      async (_session: unknown, tool: string, args: Record<string, unknown>) => {
        if (tool === "get_datadog_metric") return mcpJson([]);
        if (tool === "get_datadog_metric_context") {
          if (String(args.metric_name) === "aws.lambda.duration") {
            return mcpJson({
              metric_name: "aws.lambda.duration",
              tags_data: {
                indexed_tags: {
                  env: ["prod"],
                  functionname: ["invoice-prod", "prod-galaxy-profilefetch-a1b2c3"],
                  service: ["galaxy-console"],
                },
              },
            });
          }
          return mcpJson({ metric_name: String(args.metric_name), tags_data: { indexed_tags: {} } });
        }
        if (tool === "search_datadog_spans") {
          return mcpJson({ spans: [{ duration_ms: 2100 }, { duration_ms: 4200 }, { duration_ms: 6100 }] });
        }
        if (tool === "search_datadog_logs") return mcpJson({ logs: [] });
        return mcpJson({});
      },
    );

    const pctx = mockPipelineContext({ cwd: "/tmp/project", execSafeFn: vi.fn(async () => "aws.lambda.duration") });

    const traceResult = await runDatadogInvestigation({
      prompt: "investigate the profile fetch lambda in prod",
      request: parseDatadogRequest("investigate the profile fetch lambda in prod"),
      candidate: profileCandidate,
      pctx,
    });
    const invoiceResult = await runDatadogInvestigation({
      prompt: "investigate the invoice lambda in prod",
      request: parseDatadogRequest("investigate the invoice lambda in prod"),
      candidate: invoiceCandidate,
      pctx,
    });

    expect(traceResult.report).toContain("Metric data was sparse, so Datadog trace search was used as a fallback.");
    expect(traceResult.report).toContain("Span count: 3");
    expect(traceResult.report).toContain("- p95: 6.10 s");
    expect(invoiceResult.report).toContain(
      "Recent error logs:\n- No recent error logs matched the resolved Lambda name/tags.",
    );
    expect(traceResult.isError).toBeUndefined();
    expect(invoiceResult.isError).toBeUndefined();
  });
});
