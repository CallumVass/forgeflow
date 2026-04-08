import { mockPipelineContext, mockRunAgent } from "@callumvass/forgeflow-shared/testing";
import { describe, expect, it } from "vitest";
import { runDiscoverSkills } from "./discover-skills.js";

describe("runDiscoverSkills", () => {
  it("install mode runs skill-discoverer with an install task and no tools override", async () => {
    const runAgentFn = mockRunAgent("installed");
    const pctx = mockPipelineContext({ runAgentFn });

    await runDiscoverSkills("cloudflare,wrangler", pctx);

    expect(runAgentFn).toHaveBeenCalledTimes(1);
    const [agent, task, opts] = runAgentFn.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(agent).toBe("skill-discoverer");
    expect(task).toMatch(/^Install these skills/);
    expect(opts).not.toHaveProperty("tools");
  });

  it("discover mode runs skill-discoverer with a discover task and no tools override", async () => {
    const runAgentFn = mockRunAgent("found");
    const pctx = mockPipelineContext({ runAgentFn });

    await runDiscoverSkills("rust async", pctx);

    const [agent, task, opts] = runAgentFn.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(agent).toBe("skill-discoverer");
    expect(task).toMatch(/Discover skills related to/);
    expect(opts).not.toHaveProperty("tools");
  });
});
