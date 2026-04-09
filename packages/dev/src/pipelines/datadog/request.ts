interface DatadogRequest {
  originalPrompt: string;
  intent: "percentiles" | "investigate";
  env?: string;
  windowMs: number;
}

const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;

function parseWindowMs(prompt: string): number {
  const lower = prompt.toLowerCase();
  const match = lower.match(/\b(\d+)\s*(m|h|d|w)\b/);
  if (!match) return DEFAULT_WINDOW_MS;

  const value = Number(match[1]);
  const unit = match[2];
  if (!Number.isFinite(value) || value <= 0 || !unit) return DEFAULT_WINDOW_MS;

  switch (unit) {
    case "m":
      return value * 60 * 1000;
    case "h":
      return value * 60 * 60 * 1000;
    case "d":
      return value * 24 * 60 * 60 * 1000;
    case "w":
      return value * 7 * 24 * 60 * 60 * 1000;
    default:
      return DEFAULT_WINDOW_MS;
  }
}

function parseEnv(prompt: string): string | undefined {
  const lower = prompt.toLowerCase();
  if (/\bproduction\b|\bprod\b/.test(lower)) return "prod";
  if (/\bstaging\b|\bstage\b/.test(lower)) return "staging";
  if (/\bdevelopment\b|\bdev\b/.test(lower)) return "dev";
  const explicit = lower.match(/\benv\s*[:=]\s*([a-z0-9_-]+)/);
  return explicit?.[1];
}

export function parseDatadogRequest(prompt: string): DatadogRequest {
  const lower = prompt.toLowerCase();
  const intent = /\bp\d+\b|\bpercentile\b|\bpercentiles\b|\bp50\b|\bp95\b|\bp99\b/.test(lower)
    ? "percentiles"
    : "investigate";

  return {
    originalPrompt: prompt,
    intent,
    env: parseEnv(prompt),
    windowMs: parseWindowMs(prompt),
  };
}
