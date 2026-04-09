import * as fs from "node:fs";
import * as path from "node:path";
import { type PipelineContext, type PipelineResult, pipelineResult } from "@callumvass/forgeflow-shared/pipeline";

/**
 * PRD.md filesystem mechanics. All PRD IO for PM pipelines flows through this
 * module — pipelines must not `import "node:fs"` for PRD operations.
 *
 * PRD IO is intentionally throw-on-missing (unlike `signals.ts`, which swallows
 * errors and returns `null`): PRD.md is the long-lived document every PM
 * pipeline orbits, not a transient discriminator file. Callers should guard
 * with `prdExists` and return early before attempting to read.
 */
export const PRD_FILE = "PRD.md";

export function prdPath(cwd: string): string {
  return path.join(cwd, PRD_FILE);
}

export function prdExists(cwd: string): boolean {
  return fs.existsSync(prdPath(cwd));
}

export function readPrd(cwd: string): string {
  return fs.readFileSync(prdPath(cwd), "utf-8");
}

export function writePrd(cwd: string, content: string): void {
  fs.writeFileSync(prdPath(cwd), content, "utf-8");
}

/**
 * Show the editor with the current PRD content. If the user edits and the
 * content changes, persist to disk. Returns the editor result (possibly the
 * same as the original), or `null` if no UI is attached or the user cancelled.
 */
export async function promptEditPrd(pctx: PipelineContext, title: string): Promise<string | null> {
  const { cwd, ctx } = pctx;
  if (!ctx.hasUI) return null;
  const original = readPrd(cwd);
  const edited = await ctx.ui.editor(title, original);
  if (edited == null) return null;
  if (edited !== original) writePrd(cwd, edited);
  return edited;
}

/**
 * Standard "PRD.md not found" pipeline result. Callers should guard on
 * `prdExists(cwd)` and return this when the PRD is missing so every PM
 * pipeline reports the same error text.
 */
export function missingPrdResult(pipeline: string): PipelineResult {
  return pipelineResult("PRD.md not found.", pipeline, []);
}
