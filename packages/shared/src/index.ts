/**
 * @deprecated Import from sub-paths instead (e.g. '@callumvass/forgeflow-shared/types').
 * This barrel re-export is kept for backwards compatibility during migration.
 */
export { extractFlags, type FlagResult, type FlagSpecs, splitFirstToken, unquote } from "./arg-parsing.js";
export { type ConfluencePage, fetchConfluencePage } from "./confluence.js";
export { SIGNALS, TOOLS_ALL, TOOLS_NO_EDIT, TOOLS_READONLY } from "./constants.js";
export {
  type ForgeflowContext,
  type ForgeflowTheme,
  type ForgeflowUI,
  type PipelineContext,
  toAgentOpts,
  toPipelineContext,
} from "./context.js";
export { resolveRunAgent } from "./di.js";
export { type ExecFn, exec, execSafe } from "./exec.js";
export {
  buildSendMessage,
  type CommandDefinition,
  createForgeflowExtension,
  type ExtensionConfig,
  type ParamDef,
  type PipelineDefinition,
} from "./extension.js";
export { applyMessageToStage, extractFinalOutput, getFinalOutput, parseMessageLine } from "./message-parser.js";
export { emitUpdate, getLastToolCall } from "./progress.js";
export {
  type DisplayItem,
  formatToolCall,
  formatToolCallShort,
  formatUsage,
  getDisplayItems,
  renderCollapsed,
  renderExpanded,
  renderResult,
  stageIcon,
} from "./rendering.js";
export { runAgent } from "./run-agent.js";
export { cleanSignal, readSignal, signalExists, signalPath } from "./signals.js";
export {
  emptyStage,
  emptyUsage,
  type OnUpdate,
  type PipelineDetails,
  type PipelineResult,
  pipelineResult,
  type RunAgentFn,
  type RunAgentOpts,
  type StageResult,
  sumUsage,
  type UsageStats,
} from "./stage.js";
