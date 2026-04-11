import { type PipelineContext, pipelineResult } from "@callumvass/forgeflow-shared/pipeline";
import {
  buildSkillScanReport,
  defaultSkillScanInputs,
  prepareSkillContext,
  renderSkillScanReport,
  renderSkillSelectionReport,
  type SkillCommand,
} from "@callumvass/forgeflow-shared/skills";
import { resolveDiffTarget } from "../pipelines/review/diff.js";

function parseChangedFiles(output: string): string[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

async function resolveReviewChangedFiles(target: string, pctx: PipelineContext): Promise<string[]> {
  const { diffCmd, setupCmds } = await resolveDiffTarget(pctx.cwd, target, pctx.execSafeFn);
  for (const cmd of setupCmds) await pctx.execFn(cmd, pctx.cwd);
  // Once the target branch/PR is checked out, use git to resolve concrete paths.
  const output =
    (await pctx.execSafeFn("git diff --name-only main...HEAD", pctx.cwd)) ||
    (diffCmd.includes("gh pr diff") ? await pctx.execSafeFn("git diff --name-only HEAD~1...HEAD", pctx.cwd) : "");
  return parseChangedFiles(output);
}

export async function prepareImplementSkillContext(issueText: string, pctx: PipelineContext) {
  return prepareSkillContext(pctx, { command: "implement", issueText });
}

export async function prepareArchitectureSkillContext(pctx: PipelineContext) {
  return prepareSkillContext(pctx, { command: "architecture" });
}

export async function prepareReviewSkillContextFromChangedFiles(
  changedFiles: string[],
  strict: boolean,
  pctx: PipelineContext,
) {
  return prepareSkillContext(pctx, { command: strict ? "review-lite" : "review", changedFiles });
}

interface SkillScanOptions {
  command?: string;
  path?: string;
  issue?: string;
  target?: string;
  json?: boolean;
}

function isSkillCommand(value: string): value is SkillCommand {
  return [
    "implement",
    "review",
    "review-lite",
    "architecture",
    "init",
    "continue",
    "investigate",
    "create-gh-issue",
    "create-gh-issues",
  ].includes(value);
}

function buildSelectionInputs(command: SkillCommand | undefined, opts: SkillScanOptions, changedFiles: string[]) {
  const focusPaths = opts.path ? [opts.path] : [];
  if (command) {
    return [
      {
        command,
        issueText: opts.issue,
        changedFiles: command === "review" || command === "review-lite" ? changedFiles : [],
        focusPaths,
      },
    ];
  }

  return defaultSkillScanInputs().map((input) => ({
    ...input,
    issueText: opts.issue,
    changedFiles: input.command === "review" || input.command === "review-lite" ? changedFiles : [],
    focusPaths,
  }));
}

export async function runSkillScan(opts: SkillScanOptions, pctx: PipelineContext) {
  const command = opts.command && isSkillCommand(opts.command) ? opts.command : undefined;
  if (opts.command && !command) {
    return pipelineResult(`Unknown command for skill scan: ${opts.command}`, "skill-scan", [], true);
  }

  const changedFiles =
    command === "review" || command === "review-lite" || !command
      ? await resolveReviewChangedFiles(opts.target ?? "", pctx)
      : [];
  const inputs = buildSelectionInputs(command, opts, changedFiles);
  const report = await buildSkillScanReport(pctx.cwd, pctx.skillsConfig, inputs);

  if (opts.json) {
    return pipelineResult(JSON.stringify(report, null, 2), "skill-scan", []);
  }

  if (command) {
    const analysis = report.analyses[0];
    return pipelineResult(
      analysis ? renderSkillSelectionReport(analysis) : "No skill analysis available.",
      "skill-scan",
      [],
    );
  }

  return pipelineResult(renderSkillScanReport(report), "skill-scan", []);
}
