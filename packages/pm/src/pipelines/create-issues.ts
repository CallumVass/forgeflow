import * as fs from "node:fs";
import {
  emptyStage,
  type ForgeflowContext,
  type OnUpdate,
  runAgent,
  TOOLS_NO_EDIT,
} from "@callumvass/forgeflow-shared";
import { AGENTS_DIR } from "../resolve.js";

export async function runCreateIssue(
  cwd: string,
  idea: string,
  signal: AbortSignal,
  onUpdate: OnUpdate | undefined,
  ctx: ForgeflowContext,
) {
  // Ask for feature idea interactively if not provided
  if (!idea && ctx.hasUI) {
    const input = await ctx.ui.input("Feature idea?", "");
    idea = input?.trim() ?? "";
  }
  if (!idea) {
    return {
      content: [{ type: "text" as const, text: "No feature idea provided." }],
      details: { pipeline: "create-issue", stages: [] },
    };
  }

  const stages = [emptyStage("gh-single-issue-creator")];
  const opts = { agentsDir: AGENTS_DIR, cwd, signal, stages, pipeline: "create-issue", onUpdate };

  await runAgent("gh-single-issue-creator", idea, { ...opts, tools: TOOLS_NO_EDIT });

  return {
    content: [{ type: "text" as const, text: "Issue created." }],
    details: { pipeline: "create-issue", stages },
  };
}

export async function runCreateIssues(
  cwd: string,
  signal: AbortSignal,
  onUpdate: OnUpdate | undefined,
  _ctx: ForgeflowContext,
) {
  if (!fs.existsSync(`${cwd}/PRD.md`)) {
    return {
      content: [{ type: "text" as const, text: "PRD.md not found." }],
      details: { pipeline: "create-issues", stages: [] },
    };
  }

  const stages = [emptyStage("gh-issue-creator")];
  const opts = { agentsDir: AGENTS_DIR, cwd, signal, stages, pipeline: "create-issues", onUpdate };

  await runAgent(
    "gh-issue-creator",
    "Decompose PRD.md into vertical-slice GitHub issues. Read the issue-template skill for the standard format.",
    { ...opts, tools: TOOLS_NO_EDIT },
  );

  return {
    content: [{ type: "text" as const, text: "Issue creation complete." }],
    details: { pipeline: "create-issues", stages },
  };
}
