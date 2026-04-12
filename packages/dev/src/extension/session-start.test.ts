import { describe, expect, it, vi } from "vitest";
import { readRememberedDevInvocations, restoreDevSessionState } from "./session-start.js";

describe("restoreDevSessionState", () => {
  it("restores remembered implement and review invocations from forgeflow-dev session entries only", () => {
    const getEntries = vi.fn(() => [
      {
        type: "custom",
        customType: "forgeflow-command",
        data: { toolName: "forgeflow-dev", command: "implement", params: { issue: "42", skipReview: true } },
      },
      {
        type: "custom",
        customType: "forgeflow-command",
        data: { toolName: "forgeflow-dev", command: "review", params: { target: "17", strict: true } },
      },
      {
        type: "custom",
        customType: "forgeflow-command",
        data: { toolName: "forgeflow-pm", command: "continue", params: { issue: "Ignore me" } },
      },
      {
        type: "custom",
        customType: "something-else",
        data: { toolName: "forgeflow-dev", command: "implement", params: { issue: "99" } },
      },
    ]);
    const hydrate = vi.fn();
    const ctx = { sessionManager: { getEntries } };

    restoreDevSessionState(ctx as never, hydrate);

    expect(hydrate).toHaveBeenCalledWith([
      { command: "implement", params: { issue: "42", skipReview: true } },
      { command: "review", params: { target: "17", strict: true } },
    ]);
  });

  it("returns an empty remembered list when getEntries is unavailable", () => {
    const ctx = { sessionManager: { getBranch: () => [] } };

    expect(readRememberedDevInvocations(ctx as never)).toEqual([]);
  });
});
