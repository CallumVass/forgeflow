import { mockExecFn } from "@callumvass/forgeflow-shared/testing";
import { describe, expect, it, vi } from "vitest";

vi.mock("@callumvass/forgeflow-shared/repository", () => ({
  readCurrentPrNumber: vi.fn(async () => undefined),
}));

import { readCurrentPrNumber } from "@callumvass/forgeflow-shared/repository";
import { resolveDiffTarget } from "./diff.js";

describe("resolveDiffTarget", () => {
  it("returns a PR review target when the target is a numeric string", async () => {
    const execFn = mockExecFn();
    const result = await resolveDiffTarget("/tmp", "42", execFn);

    expect(result).toEqual({ kind: "pr", prNumber: "42" });
  });

  it("returns a branch review target when target starts with --branch", async () => {
    const execFn = mockExecFn();
    const result = await resolveDiffTarget("/tmp", "--branch feat/foo", execFn);

    expect(result).toEqual({ kind: "branch", branch: "feat/foo" });
  });

  it("defaults to the current branch when --branch has no branch name", async () => {
    const execFn = mockExecFn();
    const result = await resolveDiffTarget("/tmp", "--branch", execFn);

    expect(result).toEqual({ kind: "current" });
  });

  it("auto-detects PR number from the repository boundary when target is empty", async () => {
    vi.mocked(readCurrentPrNumber).mockResolvedValueOnce("99");
    const execFn = mockExecFn();
    const result = await resolveDiffTarget("/tmp", "", execFn);

    expect(result).toEqual({ kind: "current", prNumber: "99" });
    expect(readCurrentPrNumber).toHaveBeenCalledWith({ cwd: "/tmp", execSafeFn: execFn });
  });

  it("returns a current-branch review target when PR auto-detection fails", async () => {
    const execFn = mockExecFn({});
    const result = await resolveDiffTarget("/tmp", "", execFn);

    expect(result).toEqual({ kind: "current", prNumber: undefined });
  });
});
