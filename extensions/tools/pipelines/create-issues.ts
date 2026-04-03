import * as fs from "node:fs";
import { TOOLS_NO_EDIT } from "../constants.js";
import { runAgent } from "../run-agent.js";
import { type AnyCtx, emptyStage } from "../types.js";

export async function runCreateIssue(cwd: string, idea: string, signal: AbortSignal, onUpdate: AnyCtx, _ctx: AnyCtx) {
  if (!idea) {
    return {
      content: [{ type: "text" as const, text: "No feature idea provided." }],
      details: { pipeline: "create-issue", stages: [] },
    };
  }

  const stages = [emptyStage("single-issue-creator")];
  const opts = { cwd, signal, stages, pipeline: "create-issue", onUpdate };

  await runAgent("single-issue-creator", idea, { ...opts, tools: TOOLS_NO_EDIT });

  return {
    content: [{ type: "text" as const, text: "Issue created." }],
    details: { pipeline: "create-issue", stages },
  };
}

export async function runCreateIssues(cwd: string, signal: AbortSignal, onUpdate: AnyCtx, _ctx: AnyCtx) {
  if (!fs.existsSync(`${cwd}/PRD.md`)) {
    return {
      content: [{ type: "text" as const, text: "PRD.md not found." }],
      details: { pipeline: "create-issues", stages: [] },
    };
  }

  const stages = [emptyStage("issue-creator")];
  const opts = { cwd, signal, stages, pipeline: "create-issues", onUpdate };

  await runAgent(
    "issue-creator",
    "Decompose PRD.md into vertical-slice GitHub issues. Read the issue-template skill for the standard format.",
    { ...opts, tools: TOOLS_NO_EDIT },
  );

  return {
    content: [{ type: "text" as const, text: "Issue creation complete." }],
    details: { pipeline: "create-issues", stages },
  };
}
