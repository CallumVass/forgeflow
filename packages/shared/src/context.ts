import type { SessionEntry } from "@mariozechner/pi-coding-agent";
import { type ExecFn, exec, execSafe } from "./exec.js";
import { type AgentConfig, DEFAULT_SESSIONS, loadForgeflowConfig, type SessionsConfig } from "./forgeflow-config.js";
import { runAgent } from "./run-agent.js";
import type { RunDirHandle } from "./run-dir.js";
import type { OnUpdate, RunAgentFn, RunAgentOpts, StageResult } from "./stages.js";

export type { ExecFn } from "./exec.js";
export type { ArchiveOutcome, RunDirHandle } from "./run-dir.js";
export { withRunLifecycle } from "./run-dir.js";

// ─── Context types and builders ───────────────────────────────────────

/** Structural theme interface — subset of Pi's Theme class used by rendering. */
export interface ForgeflowTheme {
  fg(color: string, text: string): string;
  bold(text: string): string;
}

/** Notification severity levels accepted by `ForgeflowUI.notify`. */
export type ForgeflowNotifyLevel = "info" | "warning" | "error";

/** A minimal Component shape returned from `ForgeflowUI.custom` factories. */
export interface ForgeflowCustomComponent {
  render(width: number): string[];
  invalidate?(): void;
  handleInput?(data: string): void;
  dispose?(): void;
}

/** Minimal TUI handle passed to `ForgeflowUI.custom` factories. */
export interface ForgeflowTui {
  requestRender(): void;
}

/** Overlay positioning/sizing options passed through to pi. */
export interface ForgeflowOverlayOptions {
  anchor?: string;
  width?: string | number;
  maxHeight?: string | number;
  minWidth?: number;
  visible?: (width: number, height: number) => boolean;
}

/** Options accepted by `ForgeflowUI.custom`. */
export interface ForgeflowCustomOptions {
  overlay?: boolean;
  overlayOptions?: ForgeflowOverlayOptions;
}

/** Factory signature for `ForgeflowUI.custom`. */
export type ForgeflowCustomFactory<T> = (
  tui: ForgeflowTui,
  theme: ForgeflowTheme,
  keybindings: unknown,
  done: (result: T) => void,
) => ForgeflowCustomComponent | Promise<ForgeflowCustomComponent>;

/** Read-only view of the session used by the stages overlay. */
export interface ForgeflowSessionManager {
  getBranch(): SessionEntry[];
}

/** Subset of ExtensionUIContext that forgeflow actually uses. */
export interface ForgeflowUI {
  input(title: string, placeholder?: string): Promise<string | undefined>;
  editor(title: string, content: string): Promise<string | undefined>;
  select(title: string, options: string[]): Promise<string | undefined>;
  setStatus(key: string, text: string | undefined): void;
  setWidget(key: string, content: string[] | undefined): void;
  /** Show a transient notification. */
  notify(message: string, level?: ForgeflowNotifyLevel): void;
  /** Show a custom component (optionally as an overlay) and await its result. */
  custom<T>(factory: ForgeflowCustomFactory<T>, options?: ForgeflowCustomOptions): Promise<T>;
  /** Active theme — used by the live widget builder so the in-widget tool calls match the in-conversation row. */
  readonly theme: ForgeflowTheme;
}

/** What forgeflow actually needs from the extension context. */
export interface ForgeflowContext {
  hasUI: boolean;
  cwd: string;
  ui: ForgeflowUI;
  sessionManager: ForgeflowSessionManager;
}

/**
 * The arguments that appear in every pipeline function, bundled as one object.
 *
 * `runAgentFn`, `execFn` and `execSafeFn` are dependency-injection seams.
 * Pipelines must read sub-process spawning and shell execution from this context
 * — they must NOT import `runAgent`, `exec`, or `execSafe` directly. Defaults are
 * wired by `toPipelineContext` at the extension boundary; tests inject spies via
 * `mockPipelineContext`.
 */
export interface PipelineContext {
  cwd: string;
  signal: AbortSignal;
  onUpdate: OnUpdate | undefined;
  ctx: ForgeflowContext;
  agentsDir: string;
  /** Spawn a forgeflow sub-agent. */
  runAgentFn: RunAgentFn;
  /** Run a shell command via bash. Throws on non-zero exit. */
  execFn: ExecFn;
  /** Run a shell command via bash. Returns empty string on failure. */
  execSafeFn: ExecFn;
  /**
   * Per-agent model / thinking overrides, loaded once at boundary
   * construction from `.forgeflow.json` (project) merged over
   * `~/.pi/agent/forgeflow.json` (global). Keyed by agent file stem.
   * An empty object means every stage inherits the parent pi session's
   * model and thinking level — today's default behaviour.
   */
  agentOverrides: Record<string, AgentConfig>;
  /**
   * Sub-agent session persistence config. Loaded once at boundary
   * construction from `.forgeflow.json` + `~/.pi/agent/forgeflow.json`,
   * back-filled with `DEFAULT_SESSIONS`. When `persist` is `false`,
   * `withRunLifecycle` is a no-op and `runAgent` falls back to
   * `--no-session` behaviour project-wide.
   */
  sessionsConfig: SessionsConfig;
  /**
   * Active run directory handle, set by `withRunLifecycle` for the
   * duration of a pipeline run. Pipelines that need to thread session
   * paths between phases (the chain-builder) read this directly; the
   * patched `runAgentFn` installed by `withRunLifecycle` auto-allocates
   * a session file per call for callers that do not thread manually.
   * `undefined` outside of `withRunLifecycle` or when persistence is
   * disabled.
   */
  runDir?: RunDirHandle;
}

/** Build a PipelineContext from the raw extension execute() arguments. */
export function toPipelineContext(
  cwd: string,
  signal: AbortSignal,
  onUpdate: OnUpdate,
  ctx: ForgeflowContext,
  agentsDir: string,
  overrides?: Partial<
    Pick<PipelineContext, "runAgentFn" | "execFn" | "execSafeFn" | "agentOverrides" | "sessionsConfig">
  >,
): PipelineContext {
  // Load forgeflow.json exactly once per pipeline run at the boundary.
  // Warnings are routed through `ctx.ui.notify` so they reach the user
  // without corrupting the pi TUI (the rest of forgeflow uses the same
  // channel; no module in packages/*/src/*.ts calls `console.*`).
  const loaded = loadForgeflowConfig(cwd, (msg) => ctx.ui.notify(msg, "warning"));
  const agentOverrides = overrides?.agentOverrides ?? loaded.agents ?? {};
  // `loadForgeflowConfig` back-fills `sessions` with DEFAULT_SESSIONS
  // before returning, so the `?? DEFAULT_SESSIONS` below is defensive
  // belt-and-braces for the type system rather than a runtime path.
  const sessionsConfig = overrides?.sessionsConfig ?? loaded.sessions ?? DEFAULT_SESSIONS;

  return {
    cwd,
    signal,
    onUpdate: onUpdate as OnUpdate | undefined,
    ctx,
    agentsDir,
    runAgentFn: overrides?.runAgentFn ?? runAgent,
    execFn: overrides?.execFn ?? exec,
    execSafeFn: overrides?.execSafeFn ?? execSafe,
    agentOverrides,
    sessionsConfig,
  };
}

/** Convert a PipelineContext + pipeline-specific extras into RunAgentOpts. */
export function toAgentOpts(pctx: PipelineContext, extra: { stages: StageResult[]; pipeline: string }): RunAgentOpts {
  return {
    cwd: pctx.cwd,
    signal: pctx.signal,
    onUpdate: pctx.onUpdate,
    agentsDir: pctx.agentsDir,
    agentOverrides: pctx.agentOverrides,
    ...extra,
  };
}
