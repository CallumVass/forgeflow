import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { mockForgeflowContext, mockPipelineContext } from "@callumvass/forgeflow-shared/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PRD_FILE, prdExists, prdPath, promptEditPrd, readPrd, writePrd } from "./document.js";

describe("prd-document", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("prdExists is true when PRD.md is present and false otherwise", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "prd-test-"));
    expect(prdPath(tmpDir)).toBe(path.join(tmpDir, PRD_FILE));
    expect(prdExists(tmpDir)).toBe(false);

    fs.writeFileSync(prdPath(tmpDir), "# PRD");
    expect(prdExists(tmpDir)).toBe(true);
  });

  it("writePrd then readPrd round-trips content as UTF-8", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "prd-test-"));
    const content = "# PRD\n\nSome body with ünicode ✅\n";

    writePrd(tmpDir, content);

    expect(readPrd(tmpDir)).toBe(content);
    expect(fs.readFileSync(path.join(tmpDir, PRD_FILE), "utf-8")).toBe(content);
  });

  it("promptEditPrd returns null and never calls editor when ctx.hasUI is false", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "prd-test-"));
    writePrd(tmpDir, "# original");
    const editor = vi.fn();
    const pctx = mockPipelineContext({
      cwd: tmpDir,
      ctx: mockForgeflowContext({ hasUI: false, ui: { editor } }),
    });

    const result = await promptEditPrd(pctx, "title");

    expect(result).toBeNull();
    expect(editor).not.toHaveBeenCalled();
    expect(readPrd(tmpDir)).toBe("# original");
  });

  it("promptEditPrd returns null and does not write when the editor is cancelled", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "prd-test-"));
    writePrd(tmpDir, "# original");
    const editor = vi.fn(async () => undefined);
    const pctx = mockPipelineContext({
      cwd: tmpDir,
      ctx: mockForgeflowContext({ hasUI: true, ui: { editor } }),
    });

    const result = await promptEditPrd(pctx, "title");

    expect(result).toBeNull();
    expect(editor).toHaveBeenCalledOnce();
    expect(editor).toHaveBeenCalledWith("title", "# original");
    expect(readPrd(tmpDir)).toBe("# original");
  });

  it("promptEditPrd returns the original content and does not write when the editor returns unchanged content", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "prd-test-"));
    writePrd(tmpDir, "# original");
    // Make the file read-only so any write attempt throws EACCES. If the
    // helper respects the "no change" branch, no write is attempted and the
    // call succeeds.
    const prdFilePath = path.join(tmpDir, PRD_FILE);
    fs.chmodSync(prdFilePath, 0o444);
    const editor = vi.fn(async () => "# original");
    const pctx = mockPipelineContext({
      cwd: tmpDir,
      ctx: mockForgeflowContext({ hasUI: true, ui: { editor } }),
    });

    const result = await promptEditPrd(pctx, "title");

    expect(result).toBe("# original");
    expect(readPrd(tmpDir)).toBe("# original");
    // Restore write permissions so the afterEach cleanup succeeds.
    fs.chmodSync(prdFilePath, 0o644);
  });

  it("promptEditPrd writes new content and returns it when the editor returns different content", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "prd-test-"));
    writePrd(tmpDir, "# original");
    const editor = vi.fn(async () => "# edited");
    const pctx = mockPipelineContext({
      cwd: tmpDir,
      ctx: mockForgeflowContext({ hasUI: true, ui: { editor } }),
    });

    const result = await promptEditPrd(pctx, "title");

    expect(result).toBe("# edited");
    expect(readPrd(tmpDir)).toBe("# edited");
  });
});
