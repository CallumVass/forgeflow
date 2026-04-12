import * as path from "node:path";
import type { PipelineContext } from "../runtime/index.js";
import { detectSkillSignals } from "./detectors/index.js";
import { scanRepository } from "./inventory.js";
import { selectSkills } from "./matcher.js";
import { discoverSkillLandscape } from "./roots.js";
import type { SkillScanReport, SkillSelectionInput, SkillSelectionReport } from "./types.js";

export { DEFAULT_DETECTORS, detectSkillSignals } from "./detectors/index.js";
export {
  buildSkillRecommendationReport,
  buildSkillSearchQueries,
  createSkillsCliRecommendationProvider,
  parseSkillsFindOutput,
  renderSkillRecommendationReport,
} from "./recommend.js";
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
  SkillLandscape,
  SkillRecommendationProvider,
  SkillRecommendationProviderResult,
  SkillRecommendationReport,
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
  config: PipelineContext["skillsConfig"],
  input: SkillSelectionInput,
): Promise<SkillSelectionReport> {
  const landscape = await discoverSkillLandscape(cwd, config);
  const inventory = scanRepository(cwd);
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
  };
}

export async function buildSkillScanReport(
  cwd: string,
  config: PipelineContext["skillsConfig"],
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

export async function prepareSkillContext(
  pctx: PipelineContext,
  input: SkillSelectionInput,
): Promise<{ pctx: PipelineContext; report: SkillSelectionReport }> {
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

  if (report.diagnostics.length > 0) {
    lines.push("", "### Diagnostics");
    for (const diagnostic of report.diagnostics) lines.push(`- ${diagnostic}`);
  }

  return lines.join("\n");
}

export function renderSkillScanReport(report: SkillScanReport): string {
  return report.analyses.map((analysis) => renderSkillSelectionReport(analysis)).join("\n\n---\n\n");
}

export function defaultSkillScanInputs(): SkillSelectionInput[] {
  return DEFAULT_SCAN_COMMANDS.map((command) => ({ command }));
}
