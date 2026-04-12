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
  renderCompactSkillRecommendationScanReport,
  renderCompactSkillScanReport,
  renderCompactSkillSelectionReport,
  renderSkillRecommendationReport,
  renderSkillRecommendationScanReport,
  renderSkillScanReport,
  renderSkillSelectionReport,
  type SkillCommand,
  type SkillRecommendationReport,
  type SkillRecommendationScanReport,
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
    return pipelineResult(JSON.stringify(finalReport, null, 2), "skill-scan", []);
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
      [],
    );
  }

  return pipelineResult(
    opts.verbose ? renderSkillScanReport(finalReport) : renderCompactSkillScanReport(finalReport),
    "skill-scan",
    [],
  );
}

export async function runSkillRecommend(
  opts: RepoSkillOptions,
  pctx: PipelineExecRuntime & PipelineSkillRuntime & PipelineAgentRuntime,
) {
  const command = opts.command ? (isSkillCommand(opts.command) ? opts.command : undefined) : undefined;
  if (opts.command && !command) {
    return pipelineResult(`Unknown command for skill recommendation: ${opts.command}`, "skill-recommend", [], true);
  }
  if (opts.limit !== undefined && (!Number.isInteger(opts.limit) || opts.limit < 0)) {
    return pipelineResult(`Invalid --limit for skill recommendation: ${opts.limit}`, "skill-recommend", [], true);
  }

  const changedFiles =
    command === "review" || command === "review-lite" || !command
      ? await resolveReviewChangedFiles(opts.target ?? "", pctx)
      : [];
  const inputs = buildSelectionInputs(command, opts, changedFiles);
  if (inputs.length === 0) {
    return pipelineResult("No skill recommendation input available.", "skill-recommend", [], true);
  }

  const provider = createSkillsCliRecommendationProvider(pctx.execSafeFn, pctx.cwd);
  const judgedReports: SkillRecommendationReport[] = [];
  for (const input of inputs) {
    const report = await buildSkillRecommendationReport(pctx.cwd, pctx.skillsConfig, input, provider, opts.limit);
    const judged = await judgeSkillRecommendationReport(report, pctx);
    judgedReports.push(judged.report);
  }

  if (command) {
    const [report] = judgedReports;
    if (!report) {
      return pipelineResult("No skill recommendation input available.", "skill-recommend", [], true);
    }

    if (opts.json) {
      return pipelineResult(JSON.stringify(report, null, 2), "skill-recommend", []);
    }

    return pipelineResult(
      opts.verbose ? renderSkillRecommendationReport(report) : renderCompactSkillRecommendationReport(report),
      "skill-recommend",
      [],
    );
  }

  const scanReport: SkillRecommendationScanReport = {
    repoRoot: judgedReports[0]?.repoRoot ?? pctx.cwd,
    reports: judgedReports,
  };

  if (opts.json) {
    return pipelineResult(JSON.stringify(scanReport, null, 2), "skill-recommend", []);
  }

  return pipelineResult(
    opts.verbose
      ? renderSkillRecommendationScanReport(scanReport)
      : renderCompactSkillRecommendationScanReport(scanReport),
    "skill-recommend",
    [],
  );
}
