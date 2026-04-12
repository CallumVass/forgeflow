import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import type {
  ForgeflowContext,
  ForgeflowNotifyLevel,
  ForgeflowTheme,
  OnUpdate,
  PipelineDetails,
} from "../runtime/index.js";

// ─── Public type definitions for forgeflow extensions ────────────────

export interface ParamDef {
  type: "string" | "number" | "boolean";
  description: string;
}

export interface PipelineDefinition {
  name: string;
  execute: (
    cwd: string,
    params: Record<string, unknown>,
    signal: AbortSignal,
    onUpdate: OnUpdate,
    ctx: ForgeflowContext,
  ) => Promise<AgentToolResult<PipelineDetails>>;
}

export interface CommandAutocompleteItem {
  value: string;
  label: string;
}

export interface CommandInvocation {
  params?: Record<string, string | number | boolean | undefined>;
  suffix?: string;
}

export interface CommandExecResult {
  stdout: string;
  stderr: string;
  code: number;
  killed?: boolean;
}

export interface CommandHelpers {
  exec(command: string, args?: string[], options?: { timeout?: number }): Promise<CommandExecResult>;
}

export interface CommandDefinition {
  name: string;
  description: string;
  /** Which pipeline this command invokes */
  pipeline: string;
  /** Parse raw args into params and optional suffix for the sendUserMessage template */
  parseArgs?: (args: string) => CommandInvocation;
  /** Optional static slash-command completions shown while typing args. */
  getArgumentCompletions?: (prefix: string) => CommandAutocompleteItem[] | null;
  /** Optional interactive launcher used when the command is invoked without args. */
  launch?: (ctx: ForgeflowContext, helpers: CommandHelpers) => Promise<CommandInvocation | undefined>;
}

export interface PostRunActionHelpers {
  exec(command: string, args?: string[], options?: { timeout?: number }): Promise<CommandExecResult>;
  openStages(details: PipelineDetails): Promise<void>;
  queueFollowUp(text: string): void;
  notify(message: string, level?: ForgeflowNotifyLevel): void;
}

export interface ExtensionConfig {
  toolName: string;
  toolLabel: string;
  description: string;
  /** All tool parameters (excluding `pipeline` which is auto-added) */
  params: Record<string, ParamDef>;
  pipelines: PipelineDefinition[];
  commands: CommandDefinition[];
  /** Optional hook to append custom content to renderCall output */
  renderCallExtra?: (args: Record<string, unknown>, theme: ForgeflowTheme) => string;
  /** Optional hook to remember command invocations for follow-up UX. */
  onCommandInvoked?: (commandName: string, params: Record<string, unknown>) => void;
  /** Optional hook for interactive post-run actions after a pipeline completes. */
  onResult?: (
    args: Record<string, unknown>,
    result: AgentToolResult<PipelineDetails> & { isError?: boolean },
    ctx: ForgeflowContext,
    helpers: PostRunActionHelpers,
  ) => Promise<void>;
}
