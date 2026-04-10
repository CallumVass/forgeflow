import { describe, expect, it } from "vitest";
import type { LambdaCandidate } from "../candidate.js";
import type { InvestigationSummary, MetricQueryPlan, SpanSummary } from "./contracts.js";
import { formatReport } from "./report.js";

const candidate: LambdaCandidate = {
  file: "infra/lambda.ts",
  line: 42,
  constructId: "ProfileFetch",
  functionName: "profile-fetch-prod",
  score: 1,
  reasons: [],
};

const metricPlan: MetricQueryPlan = {
  durationMetric: "galaxy_console.profile.duration",
  countMetric: "galaxy_console.profile.count",
  filters: [
    { key: "env", value: "prod" },
    { key: "lambda_function", value: "profilefetch" },
  ],
  score: 120,
  provenance: ["metric:galaxy_console.profile.duration", "matched lambda_function:profilefetch"],
};

describe("formatReport", () => {
  it("preserves the metric summary report text", () => {
    const summary: InvestigationSummary = {
      plan: metricPlan,
      percentiles: {
        metric: "galaxy_console.profile.duration",
        values: [
          { label: "avg", value: 4200 },
          { label: "p95", value: 7900 },
          { label: "p99", value: 10100 },
          { label: "max", value: 12000 },
        ],
      },
      requestCount: 12,
      failureCount: 2,
    };

    const text = formatReport({
      prompt: "tell me how the profile fetch lambda is performing in prod",
      candidate,
      env: "prod",
      windowMs: 24 * 60 * 60 * 1000,
      summary,
      attemptedPlans: [metricPlan],
    });

    expect(text).toContain("Metric used: galaxy_console.profile.duration");
    expect(text).toContain("Filters used: env:prod, lambda_function:profilefetch");
    expect(text).toContain("Request count: 12");
    expect(text).toContain("Failure count: 2 (16.7%)");
    expect(text).toContain("- p95: 7.90 s");
    expect(text).toContain("Provenance: metric:galaxy_console.profile.duration; matched lambda_function:profilefetch");
  });

  it("preserves trace fallback and no-log-match text", () => {
    const spanSummary: SpanSummary = {
      query: "env:prod service:galaxy-console resource_name:*profile*fetch*",
      count: 3,
      avgDurationMs: 2100,
      p95DurationMs: 6100,
      maxDurationMs: 6100,
    };

    const text = formatReport({
      prompt: "investigate the profile fetch lambda in prod",
      candidate,
      env: "prod",
      windowMs: 24 * 60 * 60 * 1000,
      spanSummary,
      logs: { count: 0, topMessages: [] },
      attemptedPlans: [metricPlan],
    });

    expect(text).toContain("Metric data was sparse, so Datadog trace search was used as a fallback.");
    expect(text).toContain("Trace query used: env:prod service:galaxy-console resource_name:*profile*fetch*");
    expect(text).toContain("Span count: 3");
    expect(text).toContain("- p95: 6.10 s");
    expect(text).toContain("Recent error logs:\n- No recent error logs matched the resolved Lambda name/tags.");
  });
});
