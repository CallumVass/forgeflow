import { mockExecFn, mockPipelineExecRuntime } from "@callumvass/forgeflow-shared/testing";
import { describe, expect, it } from "vitest";
import {
  listChangedFilesAgainstMain,
  readCurrentPrNumber,
  readRepositoryNameWithOwner,
  readReviewDiff,
  readUnifiedDiffAgainstMain,
  resolveReviewChangedFiles,
} from "./index.js";

describe("repository review transport", () => {
  it("reads the current PR number through the repository boundary", async () => {
    const runtime = mockPipelineExecRuntime({
      cwd: "/tmp/project",
      execSafeFn: mockExecFn({
        "gh pr view --json number --jq .number": "99",
      }),
    });

    await expect(readCurrentPrNumber(runtime)).resolves.toBe("99");
  });

  it("lists changed files against main through the repository boundary", async () => {
    const runtime = mockPipelineExecRuntime({
      cwd: "/tmp/project",
      execSafeFn: mockExecFn({
        "git diff --name-only main...HEAD": "src/foo.ts\nsrc/bar.ts\n",
      }),
    });

    await expect(listChangedFilesAgainstMain(runtime)).resolves.toEqual(["src/foo.ts", "src/bar.ts"]);
  });

  it("falls back from main...HEAD to the PR base ref when resolving changed files for a PR target", async () => {
    const runtime = mockPipelineExecRuntime({
      cwd: "/tmp/project",
      execFn: mockExecFn({ "gh pr checkout 5": "" }),
      execSafeFn: mockExecFn({
        "git diff --name-only main...HEAD": "",
        "gh pr view 5 --json baseRefName --jq .baseRefName": "main",
        'git fetch origin "main" 2>/dev/null || true': "",
        'git diff --name-only "origin/main"...HEAD': "src/foo.ts\nsrc/bar.ts\n",
      }),
    });

    await expect(resolveReviewChangedFiles({ kind: "pr", prNumber: "5" }, runtime)).resolves.toEqual([
      "src/foo.ts",
      "src/bar.ts",
    ]);
  });

  it("reads a PR diff through the repository boundary", async () => {
    const runtime = mockPipelineExecRuntime({
      cwd: "/tmp/project",
      execFn: mockExecFn({
        "gh pr checkout 5": "",
        "gh pr diff 5": "diff output",
      }),
    });

    await expect(readReviewDiff({ kind: "pr", prNumber: "5" }, runtime)).resolves.toBe("diff output");
  });

  it("reads the current repository slug through the repository boundary", async () => {
    const runtime = mockPipelineExecRuntime({
      cwd: "/tmp/project",
      execFn: mockExecFn({
        "gh repo view --json nameWithOwner --jq .nameWithOwner": "owner/repo",
      }),
    });

    await expect(readRepositoryNameWithOwner(runtime)).resolves.toBe("owner/repo");
  });

  it("reads the unified diff against main through the repository boundary", async () => {
    const runtime = mockPipelineExecRuntime({
      cwd: "/tmp/project",
      execFn: mockExecFn({
        "git diff main...HEAD": "diff output",
      }),
    });

    await expect(readUnifiedDiffAgainstMain(runtime)).resolves.toBe("diff output");
  });
});
