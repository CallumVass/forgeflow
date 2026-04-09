import { beforeEach, describe, expect, it } from "vitest";
import {
  getAtlassianCommandRegistry,
  getStagesOverlayRegistry,
  resetAtlassianCommandRegistry,
  resetStagesOverlayRegistry,
} from "./registry.js";

const STAGES_REGISTRY_KEY = Symbol.for("forgeflow.stagesOverlay.registry");
const ATLASSIAN_REGISTRY_KEY = Symbol.for("forgeflow.atlassianCommand.registry");

beforeEach(() => {
  resetStagesOverlayRegistry();
  resetAtlassianCommandRegistry();
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
    expect((globalThis as Record<symbol, unknown>)[STAGES_REGISTRY_KEY]).toBeUndefined();

    const c = getStagesOverlayRegistry();
    expect(c).not.toBe(a);
    expect(c.toolNames.size).toBe(0);
    expect(c.registered).toBe(false);

    // The new instance is now stored on globalThis.
    expect((globalThis as Record<symbol, unknown>)[STAGES_REGISTRY_KEY]).toBe(c);
  });

  it("keeps a separate process-wide registry for the shared Atlassian login command", () => {
    const a = getAtlassianCommandRegistry();
    const b = getAtlassianCommandRegistry();
    expect(b).toBe(a);

    a.registered = true;
    resetAtlassianCommandRegistry();
    expect((globalThis as Record<symbol, unknown>)[ATLASSIAN_REGISTRY_KEY]).toBeUndefined();

    const c = getAtlassianCommandRegistry();
    expect(c).not.toBe(a);
    expect(c.registered).toBe(false);
    expect((globalThis as Record<symbol, unknown>)[ATLASSIAN_REGISTRY_KEY]).toBe(c);
  });
});
