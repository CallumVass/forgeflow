import * as path from "node:path";
import type { PipelineSkillRuntime, PipelineSkillSelectionRuntime } from "../runtime/pipeline-context/index.js";
import { analyseSkillSelection } from "./analysis.js";
import { detectSkillSignals } from "./detectors/index.js";
import { scanRepository } from "./inventory.js";
import { selectSkills } from "./matcher.js";
import { discoverSkillLandscape } from "./roots.js";
import { uniqueStrings } from "./text.js";
import type { SkillScanReport, SkillSelectionInput, SkillSelectionReport } from "./types.js";

export { DEFAULT_DETECTORS, detectSkillSignals } from "./detectors/index.js";
export {
  buildSkillRecommendationReport,
  buildSkillSearchQueries,
  createSkillsCliRecommendationProvider,
  enrichSkillsCliCandidates,
  parseSkillsFindOutput,
  parseSkillsListOutput,
  renderCompactSkillRecommendationReport,
  renderCompactSkillRecommendationScanReport,
  renderSkillRecommendationReport,
  renderSkillRecommendationScanReport,
} from "./recommendation/index.js";
export type {
  DiscoveredSkill,
  ExternalSkillCandidate,
  QueriedExternalSkillCandidate,
  RecommendedExternalSkill,
  RepoFile,
  RepoInventory,
  SelectedSkill,
  SkillCommand,
  SkillDetectionContext,
  SkillDuplicate,
  SkillJudgement,
  SkillLandscape,
  SkillRecommendationProvider,
  SkillRecommendationProviderResult,
  SkillRecommendationReport,
  SkillRecommendationScanReport,
  SkillRoot,
  SkillScanReport,
  SkillSearchQuery,
  SkillSelectionInput,
  SkillSelectionReport,
  SkillSignal,
  SkillSignalDetector,
} from "./types.js";

const DEFAULT_SCAN_COMMANDS: SkillSelectionInput["command"][] = [
  "implement",
  "review",
  "architecture",
  "investigate",
  "continue",
  "create-gh-issue",
  "create-gh-issues",
  "init",
];

export async function buildSkillSelectionReport(
  cwd: string,
  config: PipelineSkillRuntime["skillsConfig"],
  input: SkillSelectionInput,
): Promise<SkillSelectionReport> {
  const { landscape, analysed, selectedSkills } = await analyseSkillSelection(cwd, config, input);

  return {
    command: input.command,
    rootsScanned: landscape.rootsScanned,
    diagnostics: landscape.diagnostics,
    discoveredSkills: landscape.discoveredSkills,
    duplicates: landscape.duplicates,
    repoRoot: analysed.repoRoot,
    changedFiles: analysed.changedFiles,
    focusPaths: analysed.focusPaths,
    signals: analysed.signals,
    selectedSkills,
  };
}

export async function buildSkillScanReport(
  cwd: string,
  config: PipelineSkillRuntime["skillsConfig"],
  inputs: SkillSelectionInput[],
): Promise<SkillScanReport> {
  const landscape = await discoverSkillLandscape(cwd, config);
  const inventory = scanRepository(cwd);
  const analyses = inputs.map((input) => {
    const analysed = detectSkillSignals(cwd, inventory, input);
    return {
      command: input.command,
      rootsScanned: landscape.rootsScanned,
      diagnostics: landscape.diagnostics,
      discoveredSkills: landscape.discoveredSkills,
      duplicates: landscape.duplicates,
      repoRoot: analysed.repoRoot,
      changedFiles: analysed.changedFiles,
      focusPaths: analysed.focusPaths,
      signals: analysed.signals,
      selectedSkills: config.enabled
        ? selectSkills(landscape.discoveredSkills, analysed.signals, input.maxSelected ?? config.maxSelected)
        : [],
    } satisfies SkillSelectionReport;
  });

  return {
    rootsScanned: landscape.rootsScanned,
    diagnostics: landscape.diagnostics,
    discoveredSkills: landscape.discoveredSkills,
    duplicates: landscape.duplicates,
    repoRoot: inventory.repoRoot,
    analyses,
  };
}

export async function prepareSkillContext<T extends PipelineSkillSelectionRuntime>(
  pctx: T,
  input: SkillSelectionInput,
): Promise<{ pctx: T; report: SkillSelectionReport }> {
  const report = await buildSkillSelectionReport(pctx.cwd, pctx.skillsConfig, input);
  return {
    pctx: {
      ...pctx,
      selectedSkills: report.selectedSkills,
    },
    report,
  };
}

function formatRoot(root: SkillSelectionReport["rootsScanned"][number], repoRoot: string): string {
  const rel = path.relative(repoRoot, root.path);
  return rel && !rel.startsWith("..") ? rel : root.path;
}

function formatSkillLine(
  skill: SkillSelectionReport["selectedSkills"][number] | SkillSelectionReport["discoveredSkills"][number],
  repoRoot: string,
): string {
  return `- ${skill.name} — ${path.relative(repoRoot, skill.filePath) || skill.filePath}`;
}

function formatReasonSummary(reasons: string[], max = 2): string | undefined {
  const uniqueReasons = uniqueStrings(reasons.map((reason) => reason.trim()).filter(Boolean));
  if (uniqueReasons.length === 0) return undefined;
  const visible = uniqueReasons.slice(0, Math.max(0, max));
  const hidden = uniqueReasons.length - visible.length;
  return hidden > 0 ? `${visible.join("; ")}; +${hidden} more` : visible.join("; ");
}

function renderCompactSelectedSkills(report: SkillSelectionReport): string[] {
  if (report.selectedSkills.length === 0) {
    return ["- No relevant skills for this stage."];
  }

  return report.selectedSkills.flatMap((skill) => {
    const lines = [`- ${skill.name} — used during ${report.command}`];
    const reasonSummary = formatReasonSummary(skill.reasons, 1);
    if (reasonSummary) lines.push(`  why: ${reasonSummary}`);
    lines.push(`  skill: ${path.relative(report.repoRoot, skill.filePath) || skill.filePath}`);
    return lines;
  });
}

export function renderCompactSkillSelectionReport(report: SkillSelectionReport): string {
  const lines: string[] = [`Skill scan (${report.command})`, "", `Stage: ${report.command}`, "", "Relevant skills:"];

  lines.push(...renderCompactSelectedSkills(report));

  if (report.judgeDiagnostics && report.judgeDiagnostics.length > 0) {
    lines.push("", "Judge diagnostics:");
    for (const diagnostic of report.judgeDiagnostics) lines.push(`- ${diagnostic}`);
  }

  lines.push("", "Use --verbose for scanned roots, signals, collisions, and diagnostics.");
  return lines.join("\n");
}

export function renderSkillSelectionReport(report: SkillSelectionReport): string {
  const lines: string[] = [
    `## Skill scan for ${report.command}`,
    "",
    `Repo root: ${report.repoRoot}`,
    `Discovered skills: ${report.discoveredSkills.length}`,
    `Selected skills: ${report.selectedSkills.length}`,
  ];

  if (report.rootsScanned.length > 0) {
    lines.push("", "### Scanned roots");
    for (const root of report.rootsScanned) {
      lines.push(`- ${formatRoot(root, report.repoRoot)} (${root.scope}, ${root.harness})`);
    }
  }

  if (report.duplicates.length > 0) {
    lines.push("", "### Name collisions");
    for (const dup of report.duplicates) {
      lines.push(`- ${dup.name}: kept ${dup.chosen.filePath}`);
      for (const ignored of dup.ignored) lines.push(`  - ignored ${ignored.filePath}`);
    }
  }

  if (report.changedFiles.length > 0) {
    lines.push("", "### Changed files");
    for (const file of report.changedFiles) lines.push(`- ${path.relative(report.repoRoot, file) || file}`);
  }

  if (report.signals.length > 0) {
    lines.push("", "### Signals");
    for (const signal of report.signals) lines.push(`- ${signal.reason}`);
  }

  lines.push("", "### Recommended skills");
  if (report.selectedSkills.length === 0) {
    lines.push("- No relevant skills matched the current repo/task signals.");
  } else {
    for (const skill of report.selectedSkills) {
      lines.push(formatSkillLine(skill, report.repoRoot));
      for (const reason of skill.reasons) lines.push(`  - ${reason}`);
    }
  }

  if (report.discoveredSkills.length > 0) {
    lines.push("", "### All discovered skills");
    for (const skill of report.discoveredSkills) lines.push(formatSkillLine(skill, report.repoRoot));
  }

  if (report.judgeDiagnostics && report.judgeDiagnostics.length > 0) {
    lines.push("", "### Judge diagnostics");
    for (const diagnostic of report.judgeDiagnostics) lines.push(`- ${diagnostic}`);
  }

  if (report.diagnostics.length > 0) {
    lines.push("", "### Diagnostics");
    for (const diagnostic of report.diagnostics) lines.push(`- ${diagnostic}`);
  }

  return lines.join("\n");
}

export function renderCompactSkillScanReport(report: SkillScanReport): string {
  const lines: string[] = [
    "Skill scan summary",
    "",
    `Repo: ${report.repoRoot}`,
    `Stages analysed: ${report.analyses.length}`,
    "",
    "Recommended by stage:",
  ];

  for (const analysis of report.analyses) {
    lines.push(`- ${analysis.command}:`);
    for (const line of renderCompactSelectedSkills(analysis)) {
      lines.push(`  ${line}`);
    }
  }

  const diagnostics = uniqueStrings(report.analyses.flatMap((analysis) => analysis.judgeDiagnostics ?? []));
  if (diagnostics.length > 0) {
    lines.push("", "Judge diagnostics:");
    for (const diagnostic of diagnostics) lines.push(`- ${diagnostic}`);
  }

  lines.push("", "Use --verbose for scanned roots, signals, collisions, and diagnostics.");
  return lines.join("\n");
}

export function renderSkillScanReport(report: SkillScanReport): string {
  return report.analyses.map((analysis) => renderSkillSelectionReport(analysis)).join("\n\n---\n\n");
}

export function defaultSkillScanInputs(): SkillSelectionInput[] {
  return DEFAULT_SCAN_COMMANDS.map((command) => ({ command }));
}
