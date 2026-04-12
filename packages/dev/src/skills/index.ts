import {
  type PipelineAgentRuntime,
  type PipelineExecRuntime,
  type PipelineSkillRuntime,
  type PipelineSkillSelectionRuntime,
  pipelineResult,
} from "@callumvass/forgeflow-shared/pipeline";
import {
  buildSkillRecommendationReport,
  buildSkillScanReport,
  createSkillsCliRecommendationProvider,
  defaultSkillScanInputs,
  prepareSkillContext,
  renderCompactSkillRecommendationReport,
  renderCompactSkillScanReport,
  renderCompactSkillSelectionReport,
  renderSkillRecommendationReport,
  renderSkillScanReport,
  renderSkillSelectionReport,
  type SkillCommand,
} from "@callumvass/forgeflow-shared/skills";
import { resolveReviewChangedFiles } from "../pipelines/review/index.js";
import { judgeSkillRecommendationReport, judgeSkillScanReport } from "./judge.js";

export async function prepareImplementSkillContext<T extends PipelineSkillSelectionRuntime>(
  issueText: string,
  pctx: T,
) {
  return prepareSkillContext(pctx, { command: "implement", issueText });
}

export async function prepareArchitectureSkillContext<T extends PipelineSkillSelectionRuntime>(pctx: T) {
  return prepareSkillContext(pctx, { command: "architecture" });
}

interface RepoSkillOptions {
  command?: string;
  path?: string;
  issue?: string;
  target?: string;
  json?: boolean;
  verbose?: boolean;
  limit?: number;
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

function buildSelectionInputs(command: SkillCommand | undefined, opts: RepoSkillOptions, changedFiles: string[]) {
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

export async function runSkillScan(
  opts: RepoSkillOptions,
  pctx: PipelineExecRuntime & PipelineSkillRuntime & PipelineAgentRuntime,
) {
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
  const judged = await judgeSkillScanReport(report, pctx);
  const finalReport = { ...report, analyses: judged.analyses };

  if (opts.json) {
    return pipelineResult(JSON.stringify(finalReport, null, 2), "skill-scan", judged.stages);
  }

  if (command) {
    const analysis = finalReport.analyses[0];
    return pipelineResult(
      analysis
        ? opts.verbose
          ? renderSkillSelectionReport(analysis)
          : renderCompactSkillSelectionReport(analysis)
        : "No skill analysis available.",
      "skill-scan",
      judged.stages,
    );
  }

  return pipelineResult(
    opts.verbose ? renderSkillScanReport(finalReport) : renderCompactSkillScanReport(finalReport),
    "skill-scan",
    judged.stages,
  );
}

export async function runSkillRecommend(
  opts: RepoSkillOptions,
  pctx: PipelineExecRuntime & PipelineSkillRuntime & PipelineAgentRuntime,
) {
  const command = opts.command ? (isSkillCommand(opts.command) ? opts.command : undefined) : "implement";
  if (opts.command && !command) {
    return pipelineResult(`Unknown command for skill recommendation: ${opts.command}`, "skill-recommend", [], true);
  }
  if (opts.limit !== undefined && (!Number.isInteger(opts.limit) || opts.limit < 0)) {
    return pipelineResult(`Invalid --limit for skill recommendation: ${opts.limit}`, "skill-recommend", [], true);
  }

  const changedFiles =
    command === "review" || command === "review-lite" ? await resolveReviewChangedFiles(opts.target ?? "", pctx) : [];
  const [input] = buildSelectionInputs(command, opts, changedFiles);
  if (!input) return pipelineResult("No skill recommendation input available.", "skill-recommend", [], true);

  const provider = createSkillsCliRecommendationProvider(pctx.execSafeFn, pctx.cwd);
  const report = await buildSkillRecommendationReport(pctx.cwd, pctx.skillsConfig, input, provider, opts.limit);
  const judged = await judgeSkillRecommendationReport(report, pctx);

  if (opts.json) {
    return pipelineResult(JSON.stringify(judged.report, null, 2), "skill-recommend", judged.stages);
  }

  return pipelineResult(
    opts.verbose
      ? renderSkillRecommendationReport(judged.report)
      : renderCompactSkillRecommendationReport(judged.report),
    "skill-recommend",
    judged.stages,
  );
}
