import * as path from "node:path";
import { SessionManager } from "@mariozechner/pi-coding-agent";
import type { StageResult } from "./stages.js";

export const FORGEFLOW_SESSION_NOTE_TYPE = "forgeflow-context-note";

export interface StageToolObservation {
  toolName: string;
  input: Record<string, unknown>;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function limitList(items: string[], max = 12): string[] {
  return items.slice(0, max);
}

function renderList(items: string[]): string {
  if (items.length === 0) return "- none recorded";
  return items.map((item) => `- ${item}`).join("\n");
}

function truncateText(text: string, maxChars = 3000): string {
  const trimmed = text.trim();
  if (!trimmed) return "(no final text output)";
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars).trimEnd()}\n...[truncated]`;
}

function collectObservedPaths(observations: StageToolObservation[], toolName: string): string[] {
  return uniqueStrings(
    observations
      .filter((obs) => obs.toolName === toolName)
      .map((obs) => asString(obs.input.path))
      .filter((value): value is string => Boolean(value)),
  );
}

function collectObservedCommands(observations: StageToolObservation[]): string[] {
  return uniqueStrings(
    observations
      .filter((obs) => obs.toolName === "bash")
      .map((obs) => asString(obs.input.command))
      .filter((value): value is string => Boolean(value)),
  );
}

export function buildStageHandoffMessage(
  stage: Pick<StageResult, "name" | "output">,
  observations: StageToolObservation[],
): string {
  const filesRead = limitList(collectObservedPaths(observations, "read"));
  const filesModified = limitList(
    uniqueStrings([...collectObservedPaths(observations, "edit"), ...collectObservedPaths(observations, "write")]),
  );
  const searchRoots = limitList(
    uniqueStrings([...collectObservedPaths(observations, "grep"), ...collectObservedPaths(observations, "find")]),
  );
  const bashCommands = limitList(collectObservedCommands(observations), 8);

  return [
    `## Forgeflow stage handoff: ${stage.name}`,
    "",
    "This note was appended automatically for the next forked stage.",
    "Use it before re-reading the same files. Re-read only to verify or gather missing detail.",
    "",
    "### Final output",
    "```text",
    truncateText(stage.output),
    "```",
    "",
    "### Files read",
    renderList(filesRead),
    "",
    "### Search roots",
    renderList(searchRoots),
    "",
    "### Files modified",
    renderList(filesModified),
    "",
    "### Bash commands",
    renderList(bashCommands),
  ].join("\n");
}

export function appendHiddenContextMessage(sessionPath: string, content: string, details?: unknown): void {
  const sessionManager = SessionManager.open(sessionPath, path.dirname(sessionPath));
  sessionManager.appendCustomMessageEntry(FORGEFLOW_SESSION_NOTE_TYPE, content, false, details);
}

export function appendStageHandoffMessage(
  sessionPath: string,
  stage: Pick<StageResult, "name" | "output">,
  observations: StageToolObservation[],
): void {
  appendHiddenContextMessage(sessionPath, buildStageHandoffMessage(stage, observations), {
    stageName: stage.name,
    filesRead: collectObservedPaths(observations, "read"),
    filesModified: uniqueStrings([
      ...collectObservedPaths(observations, "edit"),
      ...collectObservedPaths(observations, "write"),
    ]),
    searchRoots: uniqueStrings([
      ...collectObservedPaths(observations, "grep"),
      ...collectObservedPaths(observations, "find"),
    ]),
    bashCommands: collectObservedCommands(observations),
  });
}
