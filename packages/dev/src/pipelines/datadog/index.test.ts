import { mockPipelineContext } from "@callumvass/forgeflow-shared/testing";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  withDatadogMcpSession: vi.fn(),
  callDatadogMcpTool: vi.fn(),
  exploreLambdaWithAgent: vi.fn(),
}));

vi.mock("@callumvass/forgeflow-shared/datadog", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    withDatadogMcpSession: mocks.withDatadogMcpSession,
    callDatadogMcpTool: mocks.callDatadogMcpTool,
  };
});

vi.mock("./explorer.js", () => ({
  exploreLambdaWithAgent: mocks.exploreLambdaWithAgent,
}));

import { runDatadog } from "./index.js";

function mcpJson(value: unknown) {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
  };
}

describe("runDatadog", () => {
  it("discovers custom metrics and tag filters before querying", async () => {
    mocks.exploreLambdaWithAgent.mockResolvedValue({
      selected: {
        file: ".infra/lib/infra-stack.ts",
        line: 561,
        constructId: "ClientsGetMe",
        handler: "Lambda.Clients::Lambda.Clients.FunctionGetMe_FunctionHandler_Generated::FunctionHandler",
        codePath: "Lambdas/Lambda.Clients/src/Lambda.Clients",
        score: 1,
        reasons: [],
      },
      candidates: [],
      ambiguous: false,
    });

    const session = {
      serverUrl: "https://example.com/mcp",
      client: {} as never,
      transport: {} as never,
      toolNames: ["get_datadog_metric", "search_datadog_metrics", "get_datadog_metric_context", "search_datadog_logs"],
      tools: [
        { name: "get_datadog_metric", description: "Get Datadog metric timeseries" },
        { name: "search_datadog_metrics", description: "Search Datadog metrics" },
        { name: "get_datadog_metric_context", description: "Get metric context including indexed tags" },
        { name: "search_datadog_logs", description: "Search Datadog logs" },
      ],
    };

    mocks.withDatadogMcpSession.mockImplementation(async (fn: (sessionArg: unknown) => Promise<unknown>) =>
      fn(session),
    );
    mocks.callDatadogMcpTool.mockImplementation(
      async (_session: unknown, tool: string, args: Record<string, unknown>) => {
        if (tool === "search_datadog_metrics") {
          expect(args).toHaveProperty("name_filter");
          return mcpJson(["customer_interactive_backend.client.duration", "customer_interactive_backend.client.count"]);
        }

        if (tool === "get_datadog_metric_context") {
          const metricName = String(args.metric_name);
          if (metricName === "customer_interactive_backend.client.duration") {
            return mcpJson({
              metric_name: metricName,
              tags_data: {
                indexed_tags: {
                  env: ["prod", "uat"],
                  environment: ["prod", "uat"],
                  lambda_function: ["clientsgetme"],
                  functionname: ["prod-infrastack-clientsgetmed6b4e2c5-x1tvjcyjpepy"],
                  operation: ["get"],
                },
              },
              metric_metadata: { metric_type: "distribution", is_percentiles_enabled: true },
            });
          }

          if (metricName === "customer_interactive_backend.client.count") {
            return mcpJson({
              metric_name: metricName,
              tags_data: {
                indexed_tags: {
                  env: ["prod", "uat"],
                  lambda_function: ["clientsgetme"],
                  result: ["success", "failure"],
                },
              },
            });
          }
        }

        if (tool === "get_datadog_metric") {
          expect(Array.isArray(args.queries)).toBe(true);
          const queries = (args.queries as string[]) ?? [];
          expect(queries).toContain(
            "avg:customer_interactive_backend.client.duration{env:prod,lambda_function:clientsgetme}",
          );
          expect(queries).not.toContain(
            "avg:customer_interactive_backend.client.duration{env:prod,functionname:ClientsGetMe}",
          );

          return mcpJson(
            queries.map((expression) => {
              if (
                expression.startsWith("sum:customer_interactive_backend.client.count") &&
                expression.includes("result:failure")
              ) {
                return { expression, overall_stats: { sum: 2 } };
              }
              if (expression.startsWith("sum:customer_interactive_backend.client.count")) {
                return { expression, overall_stats: { sum: 12 } };
              }
              if (expression.startsWith("avg:")) return { expression, overall_stats: { avg: 4200 } };
              if (expression.startsWith("p95:")) return { expression, overall_stats: { avg: 7900 } };
              if (expression.startsWith("p99:")) return { expression, overall_stats: { avg: 10100 } };
              if (expression.startsWith("max:")) return { expression, overall_stats: { max: 12000, avg: 12000 } };
              return { expression, overall_stats: {} };
            }),
          );
        }

        if (tool === "search_datadog_logs") {
          expect(String(args.query)).toContain("lambda_function:clientsgetme");
          return mcpJson({ logs: [{ message: "Downstream timeout" }] });
        }

        return mcpJson({});
      },
    );

    const pctx = mockPipelineContext({
      cwd: "/tmp/project",
      execSafeFn: vi.fn(async () =>
        [
          "customer_interactive_backend.client.duration",
          "customer_interactive_backend.client.count",
          "some.other.package.name",
        ].join("\n"),
      ),
    });

    const result = await runDatadog("tell me how the clients me lambda is performing in prod", pctx);
    const text = result.content[0]?.text ?? "";

    expect(text).toContain("Metric used: customer_interactive_backend.client.duration");
    expect(text).toContain("Filters used: env:prod, lambda_function:clientsgetme");
    expect(text).toContain("Request count: 12");
    expect(text).toContain("Failure count: 2 (16.7%)");
    expect(text).toContain("p95: 7.90 s");
  });

  it("falls back to span search when metric data is sparse", async () => {
    mocks.exploreLambdaWithAgent.mockResolvedValue({
      selected: {
        file: "infra/lambda.ts",
        line: 42,
        constructId: "ClientsGetMe",
        score: 1,
        reasons: [],
      },
      candidates: [],
      ambiguous: false,
    });

    const session = {
      serverUrl: "https://example.com/mcp",
      client: {} as never,
      transport: {} as never,
      toolNames: ["get_datadog_metric", "get_datadog_metric_context", "search_datadog_spans", "search_datadog_logs"],
      tools: [
        { name: "get_datadog_metric", description: "Get Datadog metric timeseries" },
        { name: "get_datadog_metric_context", description: "Get metric context including indexed tags" },
        { name: "search_datadog_spans", description: "Search Datadog spans" },
        { name: "search_datadog_logs", description: "Search Datadog logs" },
      ],
    };

    mocks.withDatadogMcpSession.mockImplementation(async (fn: (sessionArg: unknown) => Promise<unknown>) =>
      fn(session),
    );
    mocks.callDatadogMcpTool.mockImplementation(
      async (_session: unknown, tool: string, args: Record<string, unknown>) => {
        if (tool === "get_datadog_metric") return mcpJson([]);
        if (tool === "get_datadog_metric_context") {
          return mcpJson({
            metric_name: "aws.lambda.duration",
            tags_data: {
              indexed_tags: {
                env: ["prod"],
                service: ["customer-interactive-backend"],
                functionname: ["prod-infrastack-clientsgetmed6b4e2c5-x1tvjcyjpepy"],
              },
            },
          });
        }
        if (tool === "search_datadog_spans") {
          expect(String(args.query)).toContain("service:customer-interactive-backend");
          expect(String(args.query)).toContain("resource_name:*");
          return mcpJson({ spans: [{ duration_ms: 2100 }, { duration_ms: 4200 }, { duration_ms: 6100 }] });
        }
        if (tool === "search_datadog_logs") return mcpJson({ logs: [] });
        return mcpJson({});
      },
    );

    const pctx = mockPipelineContext({ cwd: "/tmp/project", execSafeFn: vi.fn(async () => "") });
    const result = await runDatadog("tell me how the clients me lambda is performing in prod", pctx);
    const text = result.content[0]?.text ?? "";

    expect(text).toContain("Metric data was sparse, so Datadog trace search was used as a fallback.");
    expect(text).toContain("Span count: 3");
    expect(text).toContain("- p95: 6.10 s");
  });

  it("falls back to discovered environment tag keys instead of assuming env", async () => {
    mocks.exploreLambdaWithAgent.mockResolvedValue({
      selected: {
        file: "infra/lambda.ts",
        line: 42,
        functionName: "billing-prod",
        constructId: "BillingLambda",
        score: 1,
        reasons: [],
      },
      candidates: [],
      ambiguous: false,
    });

    const session = {
      serverUrl: "https://example.com/mcp",
      client: {} as never,
      transport: {} as never,
      toolNames: ["get_datadog_metric", "get_datadog_metric_context"],
      tools: [
        { name: "get_datadog_metric", description: "Get Datadog metric timeseries" },
        { name: "get_datadog_metric_context", description: "Get metric context including indexed tags" },
      ],
    };

    mocks.withDatadogMcpSession.mockImplementation(async (fn: (sessionArg: unknown) => Promise<unknown>) =>
      fn(session),
    );
    mocks.callDatadogMcpTool.mockImplementation(
      async (_session: unknown, tool: string, args: Record<string, unknown>) => {
        if (tool === "get_datadog_metric_context") {
          return mcpJson({
            metric_name: "aws.lambda.duration",
            tags_data: {
              indexed_tags: {
                environment: ["prod"],
                functionname: ["billing-prod"],
              },
            },
          });
        }

        if (tool === "get_datadog_metric") {
          const queries = (args.queries as string[]) ?? [];
          expect(queries).toContain("avg:aws.lambda.duration{environment:prod,functionname:billing-prod}");
          return mcpJson(
            queries.map((expression) => ({
              expression,
              overall_stats: {
                avg: expression.startsWith("sum:") ? 5 : 1800,
                sum: expression.startsWith("sum:") ? 5 : undefined,
              },
            })),
          );
        }

        return mcpJson({});
      },
    );

    const pctx = mockPipelineContext({ cwd: "/tmp/project", execSafeFn: vi.fn(async () => "") });
    const result = await runDatadog("investigate the billing lambda in prod", pctx);
    const text = result.content[0]?.text ?? "";

    expect(text).toContain("Metric used: aws.lambda.duration");
    expect(text).toContain("Filters used: environment:prod, functionname:billing-prod");
  });
});
