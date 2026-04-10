import type { LambdaCandidate } from "../candidate.js";

export interface TagFilter {
  key: string;
  value: string;
}

export interface MetricQueryPlan {
  durationMetric: string;
  countMetric?: string;
  filters: TagFilter[];
  service?: string;
  score: number;
  provenance: string[];
}

export interface PercentileValue {
  label: string;
  value?: number;
}

export interface PercentileResult {
  metric: string;
  values: PercentileValue[];
}

export interface InvestigationSummary {
  plan: MetricQueryPlan;
  percentiles: PercentileResult;
  requestCount?: number;
  failureCount?: number;
}

export interface SpanSummary {
  query: string;
  count: number;
  avgDurationMs?: number;
  p95DurationMs?: number;
  maxDurationMs?: number;
}

export interface LogSummary {
  count: number;
  topMessages: string[];
}

export interface ReportInput {
  prompt: string;
  candidate: LambdaCandidate;
  env?: string;
  windowMs: number;
  summary?: InvestigationSummary;
  spanSummary?: SpanSummary;
  logs?: LogSummary | string;
  attemptedPlans: MetricQueryPlan[];
}
