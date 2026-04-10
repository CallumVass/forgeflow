import type { DatadogMcpSession } from "@callumvass/forgeflow-shared/datadog";
import { mockPipelineContext } from "@callumvass/forgeflow-shared/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LambdaCandidate } from "../candidate.js";

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

import { discoverDatadogQueryPlans } from "./plan-discovery.js";

function mcpJson(value: unknown) {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
  };
}

describe("discoverDatadogQueryPlans", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("builds ranked plans from catalogue and metric context discovery", async () => {
    const session = {
      toolNames: ["search_datadog_metrics", "get_datadog_metric_context"],
      tools: [
        { name: "search_datadog_metrics", description: "Search Datadog metrics" },
        { name: "get_datadog_metric_context", description: "Get metric context including indexed tags" },
      ],
    } as Pick<DatadogMcpSession, "toolNames" | "tools"> as DatadogMcpSession;
    const candidate: LambdaCandidate = {
      file: "infra/lambda.ts",
      line: 42,
      constructId: "ProfileFetch",
      functionName: "profile-fetch-prod",
      score: 1,
      reasons: [],
    };
    const pctx = mockPipelineContext({
      cwd: "/tmp/project",
      execSafeFn: vi.fn(async () => ["galaxy_console.profile.duration", "galaxy_console.profile.count"].join("\n")),
    });

    mocks.callDatadogMcpTool.mockImplementation(
      async (_session: unknown, tool: string, args: Record<string, unknown>) => {
        if (tool === "search_datadog_metrics") {
          expect(args).toHaveProperty("name_filter");
          return mcpJson(["galaxy_console.profile.duration", "galaxy_console.profile.count"]);
        }

        if (tool === "get_datadog_metric_context") {
          return mcpJson({
            metric_name: String(args.metric_name),
            tags_data: {
              indexed_tags: {
                env: ["prod", "uat"],
                lambda_function: ["profilefetch"],
                service: ["galaxy-console"],
              },
            },
          });
        }

        return mcpJson({});
      },
    );

    const plans = await discoverDatadogQueryPlans(session, candidate, "prod", pctx);

    expect(plans[0]).toMatchObject({
      durationMetric: "galaxy_console.profile.duration",
      countMetric: "galaxy_console.profile.count",
      filters: [
        { key: "env", value: "prod" },
        { key: "lambda_function", value: "profilefetch" },
      ],
      service: "galaxy-console",
    });
    expect(plans[0]?.provenance).toContain("used metric context discovery");
  });

  it("matches partial lambda names before falling back to wildcard filters", async () => {
    const session = {
      toolNames: ["get_datadog_metric_context"],
      tools: [{ name: "get_datadog_metric_context", description: "Get metric context including indexed tags" }],
    } as Pick<DatadogMcpSession, "toolNames" | "tools"> as DatadogMcpSession;
    const candidate: LambdaCandidate = {
      file: "infra/lambda.ts",
      line: 42,
      constructId: "ProfileFetch",
      score: 1,
      reasons: [],
    };
    const pctx = mockPipelineContext({ cwd: "/tmp/project", execSafeFn: vi.fn(async () => "aws.lambda.duration") });

    mocks.callDatadogMcpTool.mockResolvedValueOnce(
      mcpJson({
        metric_name: "aws.lambda.duration",
        tags_data: {
          indexed_tags: {
            env: ["prod"],
            functionname: ["prod-galaxy-profilefetch-a1b2c3"],
          },
        },
      }),
    );

    const matchedPlans = await discoverDatadogQueryPlans(session, candidate, "prod", pctx);

    expect(matchedPlans[0]?.filters).toEqual([
      { key: "env", value: "prod" },
      { key: "functionname", value: "prod-galaxy-profilefetch-a1b2c3" },
    ]);

    mocks.callDatadogMcpTool.mockResolvedValueOnce(
      mcpJson({
        metric_name: "aws.lambda.duration",
        tags_data: {
          indexed_tags: {
            env: ["prod"],
            functionname: ["other-lambda"],
          },
        },
      }),
    );

    const wildcardPlans = await discoverDatadogQueryPlans(session, candidate, "prod", pctx);

    expect(wildcardPlans.some((plan) => plan.filters.some((filter) => filter.value === "*profile*fetch*"))).toBe(true);
  });
});
