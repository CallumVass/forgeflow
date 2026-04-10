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

function mcpText(text: string) {
  return {
    content: [{ type: "text", text }],
  };
}

describe("runDatadog", () => {
  it("discovers custom metrics and tag filters before querying", async () => {
    mocks.exploreLambdaWithAgent.mockResolvedValue({
      selected: {
        file: ".infra/lib/infra-stack.ts",
        line: 561,
        constructId: "ProfileFetch",
        handler: "Galaxy.Profile::Galaxy.Profile.FetchHandler::Handle",
        codePath: "Services/Galaxy.Profile",
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
          return mcpJson(["galaxy_console.profile.duration", "galaxy_console.profile.count"]);
        }

        if (tool === "get_datadog_metric_context") {
          const metricName = String(args.metric_name);
          if (metricName === "galaxy_console.profile.duration") {
            return mcpJson({
              metric_name: metricName,
              tags_data: {
                indexed_tags: {
                  env: ["prod", "uat"],
                  environment: ["prod", "uat"],
                  lambda_function: ["profilefetch"],
                  functionname: ["prod-galaxy-profilefetch-a1b2c3"],
                  operation: ["get"],
                },
              },
              metric_metadata: { metric_type: "distribution", is_percentiles_enabled: true },
            });
          }

          if (metricName === "galaxy_console.profile.count") {
            return mcpJson({
              metric_name: metricName,
              tags_data: {
                indexed_tags: {
                  env: ["prod", "uat"],
                  lambda_function: ["profilefetch"],
                  result: ["success", "failure"],
                },
              },
            });
          }
        }

        if (tool === "get_datadog_metric") {
          expect(Array.isArray(args.queries)).toBe(true);
          const queries = (args.queries as string[]) ?? [];
          expect(queries).toContain("avg:galaxy_console.profile.duration{env:prod,lambda_function:profilefetch}");
          expect(queries).not.toContain("avg:galaxy_console.profile.duration{env:prod,functionname:ProfileFetch}");

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
              if (expression.startsWith("max:")) return { expression, overall_stats: { max: 12000, avg: 12000 } };
              return { expression, overall_stats: {} };
            }),
          );
        }

        if (tool === "search_datadog_logs") {
          expect(String(args.query)).toContain("lambda_function:profilefetch");
          return mcpJson({ logs: [{ message: "Downstream timeout" }] });
        }

        return mcpJson({});
      },
    );

    const pctx = mockPipelineContext({
      cwd: "/tmp/project",
      execSafeFn: vi.fn(async () =>
        ["galaxy_console.profile.duration", "galaxy_console.profile.count", "some.other.package.name"].join("\n"),
      ),
    });

    const result = await runDatadog("tell me how the profile fetch lambda is performing in prod", pctx);
    const text = result.content[0]?.text ?? "";

    expect(text).toContain("Metric used: galaxy_console.profile.duration");
    expect(text).toContain("Filters used: env:prod, lambda_function:profilefetch");
    expect(text).toContain("Request count: 12");
    expect(text).toContain("Failure count: 2 (16.7%)");
    expect(text).toContain("p95: 7.90 s");
  });

  it("parses wrapped Datadog metric payloads before reporting", async () => {
    mocks.exploreLambdaWithAgent.mockResolvedValue({
      selected: {
        file: "infra/lambda.ts",
        line: 42,
        constructId: "ProfileFetch",
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
          return mcpJson(["galaxy_console.profile.duration", "galaxy_console.profile.count"]);
        }

        if (tool === "get_datadog_metric_context") {
          return mcpJson({
            metric_name: "galaxy_console.profile.duration",
            tags_data: {
              indexed_tags: {
                env: ["prod"],
                lambda_function: ["profilefetch"],
              },
            },
          });
        }

        if (tool === "get_datadog_metric") {
          const queries = (args.queries as string[]) ?? [];
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
                    return { expression, overall_stats: { sum: 1 } };
                  }
                  if (expression.startsWith("sum:galaxy_console.profile.count")) {
                    return { expression, overall_stats: { sum: 4 } };
                  }
                  if (expression.startsWith("avg:")) return { expression, overall_stats: { avg: 3200 } };
                  if (expression.startsWith("p95:")) return { expression, overall_stats: { avg: 5100 } };
                  if (expression.startsWith("p99:")) return { expression, overall_stats: { avg: 6800 } };
                  if (expression.startsWith("max:")) return { expression, overall_stats: { max: 7200 } };
                  return { expression, overall_stats: {} };
                }),
              ),
              "</JSON_DATA>",
            ].join("\n"),
          );
        }

        if (tool === "search_datadog_logs") {
          return mcpText(
            "<METADATA>\n  <logs_explorer_url>https://app.datadoghq.eu/logs</logs_explorer_url>\n</METADATA>\n<YAML_DATA>\n</YAML_DATA>",
          );
        }

        return mcpJson({});
      },
    );

    const pctx = mockPipelineContext({
      cwd: "/tmp/project",
      execSafeFn: vi.fn(async () => ["galaxy_console.profile.duration", "galaxy_console.profile.count"].join("\n")),
    });

    const result = await runDatadog("tell me how the profile fetch lambda is performing in prod", pctx);
    const text = result.content[0]?.text ?? "";

    expect(text).toContain("Metric used: galaxy_console.profile.duration");
    expect(text).toContain("Filters used: env:prod, lambda_function:profilefetch");
    expect(text).toContain("Request count: 4");
    expect(text).toContain("Failure count: 1 (25.0%)");
    expect(text).toContain("Recent error logs:\n- No recent error logs matched the resolved Lambda name/tags.");
  });

  it("falls back to span search when metric data is sparse", async () => {
    mocks.exploreLambdaWithAgent.mockResolvedValue({
      selected: {
        file: "infra/lambda.ts",
        line: 42,
        constructId: "ProfileFetch",
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
                service: ["galaxy-console"],
                functionname: ["prod-galaxy-profilefetch-a1b2c3"],
              },
            },
          });
        }
        if (tool === "search_datadog_spans") {
          expect(String(args.query)).toContain("service:galaxy-console");
          expect(String(args.query)).toContain("resource_name:*");
          return mcpJson({ spans: [{ duration_ms: 2100 }, { duration_ms: 4200 }, { duration_ms: 6100 }] });
        }
        if (tool === "search_datadog_logs") return mcpJson({ logs: [] });
        return mcpJson({});
      },
    );

    const pctx = mockPipelineContext({ cwd: "/tmp/project", execSafeFn: vi.fn(async () => "") });
    const result = await runDatadog("tell me how the profile fetch lambda is performing in prod", pctx);
    const text = result.content[0]?.text ?? "";

    expect(text).toContain("Metric data was sparse, so Datadog trace search was used as a fallback.");
    expect(text).toContain("Span count: 3");
    expect(text).toContain("- p95: 6.10 s");
  });

  it("recovers from partial lambda names by matching token sequences in Datadog tag values", async () => {
    mocks.exploreLambdaWithAgent.mockResolvedValue({
      selected: {
        file: "infra/lambda.ts",
        line: 42,
        constructId: "ProfileFetch",
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
                env: ["prod"],
                functionname: ["prod-galaxy-profilefetch-a1b2c3"],
              },
            },
          });
        }

        if (tool === "get_datadog_metric") {
          const queries = (args.queries as string[]) ?? [];
          expect(queries).toContain("avg:aws.lambda.duration{env:prod,functionname:prod-galaxy-profilefetch-a1b2c3}");
          return mcpJson(
            queries.map((expression) => ({
              expression,
              overall_stats: {
                avg: expression.startsWith("sum:") ? 3 : 2400,
                sum: expression.startsWith("sum:") ? 3 : undefined,
              },
            })),
          );
        }

        return mcpJson({});
      },
    );

    const pctx = mockPipelineContext({ cwd: "/tmp/project", execSafeFn: vi.fn(async () => "") });
    const result = await runDatadog("investigate the profile fetch lambda in prod", pctx);
    const text = result.content[0]?.text ?? "";

    expect(text).toContain("Metric used: aws.lambda.duration");
    expect(text).toContain("Filters used: env:prod, functionname:prod-galaxy-profilefetch-a1b2c3");
  });

  it("tries wildcard metric filters when no exact Datadog tag value can be resolved", async () => {
    mocks.exploreLambdaWithAgent.mockResolvedValue({
      selected: {
        file: "infra/lambda.ts",
        line: 42,
        constructId: "ProfileFetch",
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
      toolNames: ["get_datadog_metric"],
      tools: [{ name: "get_datadog_metric", description: "Get Datadog metric timeseries" }],
    };

    mocks.withDatadogMcpSession.mockImplementation(async (fn: (sessionArg: unknown) => Promise<unknown>) =>
      fn(session),
    );
    mocks.callDatadogMcpTool.mockImplementation(
      async (_session: unknown, tool: string, args: Record<string, unknown>) => {
        if (tool !== "get_datadog_metric") return mcpJson({});

        const queries = (args.queries as string[]) ?? [];
        if (queries.some((query) => query.includes("functionname:*profile*fetch*"))) {
          return mcpJson(
            queries.map((expression) => ({
              expression,
              overall_stats: {
                avg: expression.startsWith("sum:") ? 8 : 4100,
                sum: expression.startsWith("sum:") ? 8 : undefined,
                max: expression.startsWith("max:") ? 5200 : undefined,
              },
            })),
          );
        }

        return mcpJson([]);
      },
    );

    const pctx = mockPipelineContext({ cwd: "/tmp/project", execSafeFn: vi.fn(async () => "aws.lambda.duration") });
    const result = await runDatadog("investigate the profile fetch lambda in prod", pctx);
    const text = result.content[0]?.text ?? "";

    expect(text).toContain("Metric used: aws.lambda.duration");
    expect(text).toContain("Filters used: env:prod, functionname:*profile*fetch*");
  });

  it("falls back to discovered environment tag keys instead of assuming env", async () => {
    mocks.exploreLambdaWithAgent.mockResolvedValue({
      selected: {
        file: "infra/lambda.ts",
        line: 42,
        functionName: "invoice-prod",
        constructId: "InvoiceLambda",
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
                functionname: ["invoice-prod"],
              },
            },
          });
        }

        if (tool === "get_datadog_metric") {
          const queries = (args.queries as string[]) ?? [];
          expect(queries).toContain("avg:aws.lambda.duration{environment:prod,functionname:invoice-prod}");
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
    const result = await runDatadog("investigate the invoice lambda in prod", pctx);
    const text = result.content[0]?.text ?? "";

    expect(text).toContain("Metric used: aws.lambda.duration");
    expect(text).toContain("Filters used: environment:prod, functionname:invoice-prod");
  });
});
