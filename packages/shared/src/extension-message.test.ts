import { describe, expect, it } from "vitest";
import { buildSendMessage } from "./extension-message.js";

describe("buildSendMessage", () => {
  it("formats the template correctly for different param types", () => {
    // No params
    expect(buildSendMessage("forgeflow-test", "alpha", {})).toBe(
      'Call the forgeflow-test tool now with these exact parameters: pipeline="alpha".',
    );

    // String param (quoted)
    expect(buildSendMessage("forgeflow-test", "alpha", { issue: "42" })).toBe(
      'Call the forgeflow-test tool now with these exact parameters: pipeline="alpha", issue="42".',
    );

    // Boolean and number params (unquoted)
    expect(buildSendMessage("forgeflow-test", "alpha", { skipPlan: true, maxIter: 5 })).toBe(
      'Call the forgeflow-test tool now with these exact parameters: pipeline="alpha", skipPlan=true, maxIter=5.',
    );

    // With suffix appended after a single space
    expect(buildSendMessage("forgeflow-test", "alpha", { issue: "42" }, "Do not interpret.")).toBe(
      'Call the forgeflow-test tool now with these exact parameters: pipeline="alpha", issue="42". Do not interpret.',
    );
  });
});
