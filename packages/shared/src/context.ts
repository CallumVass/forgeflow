import type { OnUpdate, RunAgentOpts, StageResult } from "./stage.js";

/** Subset of ExtensionUIContext that forgeflow actually uses. */
export interface ForgeflowUI {
  input(title: string, placeholder?: string): Promise<string | undefined>;
  editor(title: string, content: string): Promise<string | undefined>;
  select(title: string, options: string[]): Promise<string | undefined>;
  setStatus(key: string, text: string | undefined): void;
  setWidget(key: string, content: string[] | undefined): void;
}

/** What forgeflow actually needs from the extension context. */
export interface ForgeflowContext {
  hasUI: boolean;
  cwd: string;
  ui: ForgeflowUI;
}

/** Structural theme interface — subset of Pi's Theme class used by rendering. */
export interface ForgeflowTheme {
  fg(color: string, text: string): string;
  bold(text: string): string;
}

/** The arguments that appear in every pipeline function, bundled as one object. */
export interface PipelineContext {
  cwd: string;
  signal: AbortSignal;
  onUpdate: OnUpdate | undefined;
  ctx: ForgeflowContext;
  agentsDir: string;
}

/** Build a PipelineContext from the raw extension execute() arguments. */
export function toPipelineContext(
  cwd: string,
  signal: AbortSignal,
  onUpdate: OnUpdate,
  ctx: ForgeflowContext,
  agentsDir: string,
): PipelineContext {
  return { cwd, signal, onUpdate: onUpdate as OnUpdate | undefined, ctx, agentsDir };
}

/** Convert a PipelineContext + pipeline-specific extras into RunAgentOpts. */
export function toAgentOpts(pctx: PipelineContext, extra: { stages: StageResult[]; pipeline: string }): RunAgentOpts {
  return {
    cwd: pctx.cwd,
    signal: pctx.signal,
    onUpdate: pctx.onUpdate,
    agentsDir: pctx.agentsDir,
    ...extra,
  };
}
