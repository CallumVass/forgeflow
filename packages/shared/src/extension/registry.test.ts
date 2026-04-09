import { beforeEach, describe, expect, it } from "vitest";
import { getStagesOverlayRegistry, resetStagesOverlayRegistry } from "./registry.js";

const REGISTRY_KEY = Symbol.for("forgeflow.stagesOverlay.registry");

beforeEach(() => {
  resetStagesOverlayRegistry();
});

describe("stages-overlay registry", () => {
  it("returns the same instance on repeated calls and a fresh one after reset", () => {
    const a = getStagesOverlayRegistry();
    const b = getStagesOverlayRegistry();
    expect(b).toBe(a);

    a.toolNames.add("forgeflow-pm");
    a.registered = true;

    // Reset deletes the slot on globalThis so the next access creates a new
    // instance with empty state.
    resetStagesOverlayRegistry();
    expect((globalThis as Record<symbol, unknown>)[REGISTRY_KEY]).toBeUndefined();

    const c = getStagesOverlayRegistry();
    expect(c).not.toBe(a);
    expect(c.toolNames.size).toBe(0);
    expect(c.registered).toBe(false);

    // The new instance is now stored on globalThis.
    expect((globalThis as Record<symbol, unknown>)[REGISTRY_KEY]).toBe(c);
  });
});
