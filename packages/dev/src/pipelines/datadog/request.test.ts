import { describe, expect, it } from "vitest";
import { parseDatadogRequest } from "./request.js";

describe("parseDatadogRequest", () => {
  it("detects percentile prompts and env/window hints", () => {
    const result = parseDatadogRequest("give me p50 p95 and p99 for the billing lambda in prod over 7d");

    expect(result.intent).toBe("percentiles");
    expect(result.env).toBe("prod");
    expect(result.windowMs).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("defaults to investigate over 24h", () => {
    const result = parseDatadogRequest("investigate why the billing lambda is slow");

    expect(result.intent).toBe("investigate");
    expect(result.env).toBeUndefined();
    expect(result.windowMs).toBe(24 * 60 * 60 * 1000);
  });
});
