import * as fs from "node:fs";
import * as path from "node:path";
import type { Message } from "@mariozechner/pi-ai";
import {
  AuthStorage,
  createAgentSession,
  createBashTool,
  createEditTool,
  createFindTool,
  createGrepTool,
  createLsTool,
  createReadTool,
  createWriteTool,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager,
} from "@mariozechner/pi-coding-agent";
import { loadAgent } from "../agents/loader.js";
import { emitUpdate } from "./progress.js";
import { appendStageHandoffMessage, type StageToolObservation } from "./session-notes.js";
import { emptyStage, type RunAgentOpts, type StageResult } from "./stages.js";

function buildSelectedSkillsPrompt(selectedSkills: RunAgentOpts["selectedSkills"]): string {
  if (!selectedSkills || selectedSkills.length === 0) return "";
  const lines = [
    "## Preselected cross-agent skills",
    "",
    "Forgeflow shortlisted these skills as likely relevant to this run.",
    "Read the relevant `SKILL.md` files with the read tool before proceeding.",
    "Treat each skill as progressive disclosure: read `SKILL.md` first, then follow linked `references/`, examples, or scripts only when needed.",
    "Use the skills in place from their current locations. Do not move, copy, or rewrite them.",
    "",
    "Selected skills:",
  ];
  for (const skill of selectedSkills) {
    lines.push(`- ${skill.name}: ${skill.filePath}`);
    for (const reason of skill.reasons.slice(0, 2)) lines.push(`  - ${reason}`);
  }
  return lines.join("\n");
}

function buildTools(toolNames: string[], cwd: string) {
  return toolNames.map((toolName) => {
    switch (toolName) {
      case "read":
        return createReadTool(cwd);
      case "write":
        return createWriteTool(cwd);
      case "edit":
        return createEditTool(cwd);
      case "bash":
        return createBashTool(cwd);
      case "grep":
        return createGrepTool(cwd);
      case "find":
        return createFindTool(cwd);
      case "ls":
        return createLsTool(cwd);
      default:
        throw new Error(`Unsupported tool in agent frontmatter: ${toolName}`);
    }
  });
}

function materialiseFreshSession(sessionPath: string, cwd: string): void {
  const dir = path.dirname(sessionPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(sessionPath, "", { mode: 0o600 });
  fs.chmodSync(sessionPath, 0o600);

  const sessionManager = SessionManager.create(cwd, dir);
  sessionManager.setSessionFile(sessionPath);
}

/**
 * Materialise a forked session at a caller-chosen path.
 *
 * Kept for deterministic per-stage files under `.forgeflow/run/<runId>/`.
 */
function materialiseForkedSession(sessionPath: string, forkFrom: string, cwd: string): void {
  const dir = path.dirname(sessionPath);
  fs.mkdirSync(dir, { recursive: true });

  const forked = SessionManager.forkFrom(forkFrom, cwd, dir);
  const forkedPath = forked.getSessionFile();
  if (!forkedPath) {
    throw new Error(`Failed to materialise forked session from ${forkFrom}`);
  }

  try {
    fs.rmSync(sessionPath, { force: true });
  } catch {}
  fs.renameSync(forkedPath, sessionPath);
  fs.chmodSync(sessionPath, 0o600);
}

function createSessionManager(options: RunAgentOpts): SessionManager {
  if (options.sessionPath && options.forkFrom) {
    materialiseForkedSession(options.sessionPath, options.forkFrom, options.cwd);
    return SessionManager.open(options.sessionPath, path.dirname(options.sessionPath));
  }

  if (options.sessionPath) {
    materialiseFreshSession(options.sessionPath, options.cwd);
    return SessionManager.open(options.sessionPath, path.dirname(options.sessionPath));
  }

  if (options.forkFrom) {
    return SessionManager.forkFrom(options.forkFrom, options.cwd);
  }

  return SessionManager.inMemory(options.cwd);
}

function pushStageMessage(stage: StageResult, message: Message): void {
  stage.messages.push(message);
  if (message.role !== "assistant") return;

  stage.usage.turns++;
  const usage = message.usage;
  if (usage) {
    stage.usage.input += usage.input || 0;
    stage.usage.output += usage.output || 0;
    stage.usage.cacheRead += usage.cacheRead || 0;
    stage.usage.cacheWrite += usage.cacheWrite || 0;
    stage.usage.cost += usage.cost?.total || 0;
  }
  if (!stage.model && message.model) stage.model = message.model;
}

function extractFinalOutput(stage: StageResult): void {
  for (let i = stage.messages.length - 1; i >= 0; i--) {
    const message = stage.messages[i];
    if (!message || message.role !== "assistant") continue;
    for (const part of message.content) {
      if (typeof part === "object" && "type" in part && part.type === "text" && "text" in part) {
        stage.output = part.text;
        return;
      }
    }
  }
  stage.output = "";
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

type ResolvedModel = NonNullable<ReturnType<ModelRegistry["find"]>>;

function resolveModelOverride(
  modelPattern: string,
  modelRegistry: ModelRegistry,
): { model?: ResolvedModel; error?: string } {
  const available = modelRegistry.getAvailable();
  const trimmed = modelPattern.trim();
  if (!trimmed) return { error: "Empty model override." };

  const slashIdx = trimmed.indexOf("/");
  if (slashIdx > 0 && slashIdx < trimmed.length - 1) {
    const provider = trimmed.slice(0, slashIdx);
    const modelId = trimmed.slice(slashIdx + 1);
    const model = modelRegistry.find(provider, modelId);
    return model ? { model } : { error: `Unable to resolve model override: ${modelPattern}` };
  }

  const exact = available.find((candidate) => candidate.id === trimmed || candidate.name === trimmed);
  if (exact) return { model: exact };

  const lowered = trimmed.toLowerCase();
  const partials = available.filter(
    (candidate) => candidate.id.toLowerCase().includes(lowered) || candidate.name.toLowerCase().includes(lowered),
  );
  if (partials.length === 1) return { model: partials[0] };
  if (partials.length > 1) return { error: `Ambiguous model override: ${modelPattern}` };
  return { error: `Unable to resolve model override: ${modelPattern}` };
}

/** Run a forgeflow agent in-process via the Pi SDK with streaming updates. */
export async function runAgent(agentName: string, task: string, options: RunAgentOpts): Promise<StageResult> {
  const agent = await loadAgent(options.agentsDir, agentName);
  const lookupName = options.stageName ?? agentName;
  const stage =
    options.stages.find((s) => s.name === lookupName && s.status === "pending") ??
    options.stages.find((s) => s.name === lookupName);

  if (!stage) {
    const missing = emptyStage(agentName);
    missing.status = "failed";
    missing.output = "Stage not found in pipeline";
    return missing;
  }

  stage.status = "running";
  stage.startedAt ??= Date.now();
  stage.completedAt = undefined;
  emitUpdate(options);

  const settingsManager = SettingsManager.create(options.cwd);
  const authStorage = AuthStorage.create();
  const modelRegistry = ModelRegistry.create(authStorage);
  const override = options.agentOverrides?.[agentName];

  try {
    const sessionManager = createSessionManager(options);
    const loader = new DefaultResourceLoader({
      cwd: options.cwd,
      settingsManager,
      additionalSkillPaths: (options.selectedSkills ?? []).map((skill) => skill.filePath),
      appendSystemPromptOverride: (base) => {
        const appended = [buildSelectedSkillsPrompt(options.selectedSkills), agent.systemPrompt]
          .filter(Boolean)
          .join("\n\n");
        return appended ? [...base, appended] : base;
      },
    });
    await loader.reload();

    let model: ResolvedModel | undefined;
    const thinkingLevel = override?.thinkingLevel;
    if (override?.model) {
      const resolved = resolveModelOverride(override.model, modelRegistry);
      if (resolved.error || !resolved.model) {
        throw new Error(resolved.error ?? `Unable to resolve model override: ${override.model}`);
      }
      model = resolved.model;
    }

    const { session } = await createAgentSession({
      cwd: options.cwd,
      authStorage,
      modelRegistry,
      resourceLoader: loader,
      sessionManager,
      settingsManager,
      tools: buildTools(agent.tools, options.cwd),
      ...(model ? { model } : {}),
      ...(thinkingLevel ? { thinkingLevel } : {}),
    });

    const observedTools: StageToolObservation[] = [];
    const unsubscribe = session.subscribe((event) => {
      if (event.type === "tool_execution_start") {
        observedTools.push({ toolName: event.toolName, input: toRecord(event.args) });
        emitUpdate(options);
        return;
      }

      if (event.type !== "message_end") return;
      const message = event.message;
      if (message.role !== "assistant" && message.role !== "toolResult") return;
      pushStageMessage(stage, message as Message);
      emitUpdate(options);
    });

    const abort = () => {
      void session.abort();
    };

    if (options.signal?.aborted) abort();
    else options.signal?.addEventListener("abort", abort, { once: true });

    try {
      await session.prompt(`Task: ${task}`);
    } finally {
      try {
        unsubscribe();
      } catch {}
      try {
        options.signal?.removeEventListener("abort", abort);
      } catch {}
      try {
        session.dispose();
      } catch {}
    }

    stage.exitCode = 0;
    stage.status = "done";
    stage.completedAt = Date.now();
    extractFinalOutput(stage);

    const persistedSessionPath = sessionManager.getSessionFile();
    if (persistedSessionPath) {
      try {
        appendStageHandoffMessage(persistedSessionPath, stage, observedTools);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        stage.stderr += `${stage.stderr ? "\n" : ""}Failed to append stage handoff: ${msg}`;
      }
    }

    emitUpdate(options);
    return stage;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    stage.exitCode = 1;
    stage.status = "failed";
    stage.completedAt = Date.now();
    stage.stderr += `${stage.stderr ? "\n" : ""}${msg}`;
    if (!stage.output) stage.output = msg;
    emitUpdate(options);
    return stage;
  }
}
