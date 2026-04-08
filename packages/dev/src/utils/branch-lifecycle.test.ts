import { mockExecFn } from "@callumvass/forgeflow-shared/testing";
import { describe, expect, it } from "vitest";
import { setupBranch } from "./branch-lifecycle.js";

describe("setupBranch", () => {
  it("creates a fresh branch when no prior commits exist ahead of main", async () => {
    const execFn = mockExecFn({
      "rev-list": "0",
      "checkout -b": "",
      "branch --show-current": "feat/issue-42",
    });

    const result = await setupBranch("/tmp", "feat/issue-42", execFn);

    expect(result).toEqual({ status: "fresh" });
    expect(execFn).toHaveBeenCalledWith(expect.stringContaining("checkout -b"), "/tmp");
  });

  it("resumes an existing branch with commits ahead and returns ahead count", async () => {
    const execFn = mockExecFn({
      "rev-list": "3",
      "checkout feat": "",
      "branch --show-current": "feat/issue-42",
    });

    const result = await setupBranch("/tmp", "feat/issue-42", execFn);

    expect(result).toEqual({ status: "resumed", ahead: 3 });
  });

  it("returns failed when branch checkout does not land on expected branch", async () => {
    const execFn = mockExecFn({
      "rev-list": "0",
      "checkout -b": "",
      "branch --show-current": "main",
    });

    const result = await setupBranch("/tmp", "feat/issue-42", execFn);

    expect(result).toEqual({
      status: "failed",
      error: expect.stringContaining("feat/issue-42"),
    });
  });
});
