import * as path from "node:path";
import { uniqueStrings } from "../text.js";
import type { RecommendedExternalSkill, SkillRecommendationReport } from "../types.js";

function formatInstallCount(skill: RecommendedExternalSkill): string {
  return skill.installsLabel ?? (skill.installs ? `${skill.installs.toLocaleString()} installs` : "installs unknown");
}

function formatRelativePath(repoRoot: string, value: string): string {
  return path.relative(repoRoot, value) || value;
}

function formatReasonSummary(reasons: string[], max = 3): string | undefined {
  const uniqueReasons = uniqueStrings(reasons.map((reason) => reason.trim()).filter(Boolean));
  if (uniqueReasons.length === 0) return undefined;
  const visible = uniqueReasons.slice(0, Math.max(0, max));
  const hidden = uniqueReasons.length - visible.length;
  return hidden > 0 ? `${visible.join("; ")}; +${hidden} more` : visible.join("; ");
}

const MAX_RENDERED_SIGNALS = 12;

export function renderSkillRecommendationReport(report: SkillRecommendationReport): string {
  const lines: string[] = [
    `Skill recommendations (${report.command})`,
    "",
    `Repo: ${report.repoRoot}`,
    `Source: ${report.provider}`,
    `Installed matches: ${report.selectedSkills.length}`,
    `Missing recommendations: ${report.recommendedSkills.length}`,
    `Search queries: ${report.searchQueries.length}`,
    `Repo signals: ${report.signals.length}`,
  ];

  if (report.selectedSkills.length > 0) {
    lines.push(`Installed skill names: ${report.selectedSkills.map((skill) => skill.name).join(", ")}`);
  }

  if (report.rootsScanned.length > 0) {
    lines.push("", "Scanned roots:");
    for (const root of report.rootsScanned) {
      const rel = path.relative(report.repoRoot, root.path);
      lines.push(`- ${rel && !rel.startsWith("..") ? rel : root.path} (${root.scope}, ${root.harness})`);
    }
  }

  if (report.changedFiles.length > 0) {
    lines.push("", "Changed files:");
    for (const file of report.changedFiles) lines.push(`- ${formatRelativePath(report.repoRoot, file)}`);
  }

  lines.push("", "Top recommendations:");
  if (report.recommendedSkills.length === 0) {
    lines.push("- No missing skills matched the current repo signals.");
  } else {
    report.recommendedSkills.forEach((skill, index) => {
      lines.push(`${index + 1}) ${skill.id} — ${formatInstallCount(skill)}`);
      const reasonSummary = formatReasonSummary(skill.reasons);
      if (reasonSummary) lines.push(`   why: ${reasonSummary}`);
      lines.push(`   add: ${skill.installCommand}`);
      if (skill.url) lines.push(`   url: ${skill.url}`);
    });
  }

  if (report.searchQueries.length > 0) {
    lines.push("", `${report.provider} queries:`);
    for (const query of report.searchQueries) {
      const reasonSummary = formatReasonSummary(query.reasons, 2);
      lines.push(reasonSummary ? `- ${query.query} — ${reasonSummary}` : `- ${query.query}`);
    }
  }

  if (report.selectedSkills.length > 0) {
    lines.push("", "Relevant installed skills:");
    for (const skill of report.selectedSkills) {
      lines.push(`- ${skill.name} — ${formatRelativePath(report.repoRoot, skill.filePath)}`);
      const reasonSummary = formatReasonSummary(skill.reasons);
      if (reasonSummary) lines.push(`  why: ${reasonSummary}`);
    }
  }

  if (report.signals.length > 0) {
    const visibleSignals = report.signals.slice(0, MAX_RENDERED_SIGNALS);
    lines.push(
      "",
      report.signals.length > MAX_RENDERED_SIGNALS
        ? `Repo signals (${visibleSignals.length} of ${report.signals.length}):`
        : "Repo signals:",
    );
    for (const signal of visibleSignals) lines.push(`- ${signal.reason}`);
    if (report.signals.length > visibleSignals.length) {
      lines.push(`- +${report.signals.length - visibleSignals.length} more signals`);
    }
  }

  if (report.skippedInstalledSkillNames.length > 0) {
    lines.push("", "Already installed matches omitted:");
    for (const name of report.skippedInstalledSkillNames) lines.push(`- ${name}`);
  }

  if (report.duplicates.length > 0) {
    lines.push("", "Name collisions:");
    for (const dup of report.duplicates) {
      lines.push(`- ${dup.name}: kept ${formatRelativePath(report.repoRoot, dup.chosen.filePath)}`);
      for (const ignored of dup.ignored) {
        lines.push(`  - ignored ${formatRelativePath(report.repoRoot, ignored.filePath)}`);
      }
    }
  }

  if (report.providerDiagnostics.length > 0) {
    lines.push("", `${report.provider} diagnostics:`);
    for (const diagnostic of report.providerDiagnostics) lines.push(`- ${diagnostic}`);
  }

  if (report.diagnostics.length > 0) {
    lines.push("", "Diagnostics:");
    for (const diagnostic of report.diagnostics) lines.push(`- ${diagnostic}`);
  }

  return lines.join("\n");
}
