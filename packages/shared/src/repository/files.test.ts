import { mockExecFn, mockPipelineExecRuntime } from "@callumvass/forgeflow-shared/testing";
import { describe, expect, it } from "vitest";
import { listTrackedFiles } from "./index.js";

describe("repository file inspection", () => {
  it("lists tracked files through the repository boundary", async () => {
    const runtime = mockPipelineExecRuntime({
      cwd: "/tmp/project",
      execSafeFn: mockExecFn({
        "git ls-files": "README.md\nsrc/inventory/index.ts\n",
      }),
    });

    await expect(listTrackedFiles(runtime)).resolves.toEqual(["README.md", "src/inventory/index.ts"]);
  });
});
