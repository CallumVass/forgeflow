import type { PipelineExecRuntime } from "@callumvass/forgeflow-shared/pipeline";
import {
  emptyStage,
  type PipelineAgentRuntime,
  type StageResult,
  toAgentOpts,
} from "@callumvass/forgeflow-shared/pipeline";
import type {
  SkillCommand,
  SkillRecommendationReport,
  SkillSelectionReport,
  SkillSignal,
} from "@callumvass/forgeflow-shared/skills";
import {
  type DiscoveredSkill,
  enrichSkillsCliCandidates,
  type RecommendedExternalSkill,
  type SelectedSkill,
} from "@callumvass/forgeflow-shared/skills";

interface JudgedSkillChoice {
  confidence: number;
  reason: string;
}

interface SkillScanJudgeOutput {
  analyses: Array<{
    command: SkillCommand;
    selected: Array<{
      name: string;
      confidence: number;
      reason: string;
    }>;
  }>;
}

interface SkillRecommendJudgeOutput {
  selectedLocal: Array<{
    name: string;
    confidence: number;
    reason: string;
  }>;
  selectedExternal: Array<{
    id: string;
    confidence: number;
    reason: string;
  }>;
}

function uniqueStrings(values: Iterable<string>): string[] {
  return Array.from(new Set(Array.from(values).filter(Boolean)));
}

function truncate(value: string | undefined, max = 240): string | undefined {
  if (!value) return undefined;
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function formatSignals(signals: SkillSignal[], max = 10): string {
  if (signals.length === 0) return "- none";
  return signals
    .slice(0, max)
    .map((signal) => `- ${signal.reason}`)
    .join("\n");
}

function formatHeuristicSkills(skills: SelectedSkill[]): string {
  if (skills.length === 0) return "- none";
  return skills
    .map((skill) => {
      const reasons = skill.reasons.slice(0, 2).join("; ");
      return reasons ? `- ${skill.name}: ${reasons}` : `- ${skill.name}`;
    })
    .join("\n");
}

function buildLocalCatalog(skills: DiscoveredSkill[], selectedByName: Map<string, SelectedSkill>): string {
  if (skills.length === 0) return "- none";
  return skills
    .map((skill) => {
      const picked = selectedByName.get(skill.name);
      const lines = [
        `- ${skill.name}`,
        `  description: ${truncate(skill.description, 320) ?? ""}`,
        `  path: ${skill.filePath}`,
        `  root: ${skill.root.scope}/${skill.root.harness}`,
      ];
      if (picked) {
        lines.push(`  heuristic-score: ${picked.score}`);
        if (picked.reasons.length > 0) lines.push(`  heuristic-why: ${truncate(picked.reasons.join("; "), 320)}`);
      }
      return lines.join("\n");
    })
    .join("\n");
}

function buildExternalCatalog(skills: RecommendedExternalSkill[]): string {
  if (skills.length === 0) return "- none";
  return skills
    .map((skill) => {
      const lines = [
        `- ${skill.id}`,
        `  slug: ${skill.slug}`,
        `  description: ${truncate(skill.description, 320) ?? "(not available)"}`,
        `  installs: ${skill.installsLabel ?? (skill.installs != null ? String(skill.installs) : "unknown")}`,
        `  matched-queries: ${skill.matchedQueries.join(", ") || "none"}`,
      ];
      if (skill.reasons.length > 0) lines.push(`  heuristic-why: ${truncate(skill.reasons.join("; "), 320)}`);
      if (skill.url) lines.push(`  url: ${skill.url}`);
      return lines.join("\n");
    })
    .join("\n");
}

function extractJsonBlock(text: string): string | undefined {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) return text.slice(start, end + 1).trim();
  return undefined;
}

function parseJson<T>(text: string): T {
  const raw = extractJsonBlock(text);
  if (!raw) throw new Error("Skill judge did not return JSON.");
  return JSON.parse(raw) as T;
}

function toJudgedChoice(choice: { confidence?: unknown; reason?: unknown }): JudgedSkillChoice | undefined {
  const confidence =
    typeof choice.confidence === "number" ? Math.max(0, Math.min(100, Math.round(choice.confidence))) : NaN;
  const reason = typeof choice.reason === "string" ? choice.reason.trim() : "";
  if (!Number.isFinite(confidence) || reason.length === 0) return undefined;
  return { confidence, reason };
}

function buildSelectedSkill(
  discovered: DiscoveredSkill,
  prior: SelectedSkill | undefined,
  judgement: JudgedSkillChoice,
): SelectedSkill {
  return {
    name: discovered.name,
    description: discovered.description,
    filePath: discovered.filePath,
    score: prior?.score ?? judgement.confidence,
    reasons: uniqueStrings([judgement.reason, ...(prior?.reasons ?? [])]),
    root: discovered.root,
    judgement,
  };
}

function applyLocalJudgements(
  discoveredSkills: DiscoveredSkill[],
  priorSelected: SelectedSkill[],
  selected: Array<{ name: string; confidence: number; reason: string }>,
): SelectedSkill[] {
  const discoveredByName = new Map(discoveredSkills.map((skill) => [skill.name, skill]));
  const priorByName = new Map(priorSelected.map((skill) => [skill.name, skill]));
  return selected
    .map((choice) => {
      const discovered = discoveredByName.get(choice.name);
      const judgement = toJudgedChoice(choice);
      if (!discovered || !judgement) return undefined;
      return buildSelectedSkill(discovered, priorByName.get(choice.name), judgement);
    })
    .filter((skill): skill is SelectedSkill => Boolean(skill));
}

function applyExternalJudgements(
  recommendedSkills: RecommendedExternalSkill[],
  selected: Array<{ id: string; confidence: number; reason: string }>,
): RecommendedExternalSkill[] {
  const recommendedById = new Map(recommendedSkills.map((skill) => [skill.id, skill]));
  const out: RecommendedExternalSkill[] = [];

  for (const choice of selected) {
    const skill = recommendedById.get(choice.id);
    const judgement = toJudgedChoice(choice);
    if (!skill || !judgement) continue;
    out.push({
      ...skill,
      reasons: uniqueStrings([judgement.reason, ...skill.reasons]),
      judgement,
    });
  }

  return out;
}

function buildScanJudgePrompt(report: { analyses: SkillSelectionReport[] }): string {
  const discoveredSkills = report.analyses[0]?.discoveredSkills ?? [];
  const selectedByName = new Map(
    report.analyses.flatMap((analysis) => analysis.selectedSkills).map((skill) => [skill.name, skill]),
  );

  return [
    "Select only the installed skills that are materially relevant for each command analysis.",
    "",
    "Rules:",
    "- Be conservative. Returning no skills is better than returning weak matches.",
    "- Generic stack overlap alone is insufficient: TypeScript, JavaScript, Node, workspaces, tooling, agent frameworks, package managers, test runners, or popularity by themselves do not justify a recommendation.",
    "- A skill may still be relevant when its declared purpose clearly matches the command, issue text, changed files, or focus path.",
    "- The heuristic picks below are weak hints only. Reject them when the evidence is thin.",
    "- You may read local SKILL.md files if the supplied metadata is not enough.",
    "",
    "Installed skill catalogue:",
    buildLocalCatalog(discoveredSkills, selectedByName),
    "",
    "Analyses:",
    ...report.analyses.flatMap((analysis, index) => [
      `${index + 1}. command: ${analysis.command}`,
      `   repo: ${analysis.repoRoot}`,
      `   changed-files: ${analysis.changedFiles.join(", ") || "none"}`,
      `   focus-paths: ${analysis.focusPaths.join(", ") || "none"}`,
      "   signals:",
      indentBlock(formatSignals(analysis.signals), 6),
      "   heuristic-picks:",
      indentBlock(formatHeuristicSkills(analysis.selectedSkills), 6),
      "",
    ]),
    "Return JSON only using this schema:",
    "{",
    '  "analyses": [',
    '    { "command": "implement", "selected": [{ "name": "skill-name", "confidence": 0, "reason": "why it is genuinely relevant" }] }',
    "  ]",
    "}",
  ].join("\n");
}

function indentBlock(value: string, spaces: number): string {
  const prefix = " ".repeat(spaces);
  return value
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

function buildRecommendJudgePrompt(report: SkillRecommendationReport): string {
  const selectedByName = new Map(report.selectedSkills.map((skill) => [skill.name, skill]));
  return [
    "Select the genuinely relevant installed skills and missing external skills for this repo/task.",
    "",
    "Rules:",
    "- Be conservative. Returning no skills is better than weak suggestions.",
    "- Generic stack overlap alone is insufficient: languages, runtimes, common tooling, workspaces, package managers, agent frameworks, popularity, or vague query matches do not justify a selection.",
    "- Recommend an external skill only when it materially helps with this task and is not already covered well enough by a stronger local skill.",
    "- Prefer a short, high-confidence list.",
    "- You may read local SKILL.md files if the supplied metadata is not enough.",
    "",
    `Command: ${report.command}`,
    `Repo: ${report.repoRoot}`,
    `Changed files: ${report.changedFiles.join(", ") || "none"}`,
    `Focus paths: ${report.focusPaths.join(", ") || "none"}`,
    "Signals:",
    formatSignals(report.signals),
    "",
    "Installed skills:",
    buildLocalCatalog(report.discoveredSkills, selectedByName),
    "",
    "Missing external candidates:",
    buildExternalCatalog(report.recommendedSkills),
    "",
    "Return JSON only using this schema:",
    "{",
    '  "selectedLocal": [{ "name": "skill-name", "confidence": 0, "reason": "why it is genuinely relevant" }],',
    '  "selectedExternal": [{ "id": "owner/repo@skill", "confidence": 0, "reason": "why it is genuinely worth installing" }]',
    "}",
  ].join("\n");
}

async function runSkillJudge(
  prompt: string,
  pipeline: string,
  pctx: PipelineAgentRuntime,
): Promise<{
  output: string;
  stages: StageResult[];
}> {
  const stages = [emptyStage("skill-judge")];
  const result = await pctx.runAgentFn("skill-judge", prompt, {
    ...toAgentOpts(pctx, { stages, pipeline }),
    stageName: "skill-judge",
  });
  if (result.status !== "done") {
    throw new Error(result.output || result.stderr || "Skill judge failed.");
  }
  return { output: result.output, stages };
}

export async function judgeSkillScanReport(
  report: { analyses: SkillSelectionReport[] },
  pctx: PipelineAgentRuntime,
): Promise<{ analyses: SkillSelectionReport[]; judgeDiagnostics: string[]; stages: StageResult[] }> {
  if (report.analyses.every((analysis) => analysis.discoveredSkills.length === 0)) {
    return { analyses: report.analyses, judgeDiagnostics: [], stages: [] };
  }

  try {
    const { output, stages } = await runSkillJudge(buildScanJudgePrompt(report), "skill-scan", pctx);
    const parsed = parseJson<SkillScanJudgeOutput>(output);
    const judgedByCommand = new Map(parsed.analyses.map((analysis) => [analysis.command, analysis.selected]));
    const analyses = report.analyses.map((analysis) => ({
      ...analysis,
      selectedSkills: applyLocalJudgements(
        analysis.discoveredSkills,
        analysis.selectedSkills,
        judgedByCommand.get(analysis.command) ?? [],
      ),
      judgeDiagnostics: [],
    }));
    return { analyses, judgeDiagnostics: [], stages };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      analyses: report.analyses.map((analysis) => ({ ...analysis, judgeDiagnostics: [message] })),
      judgeDiagnostics: [message],
      stages: [],
    };
  }
}

export async function judgeSkillRecommendationReport(
  report: SkillRecommendationReport,
  pctx: PipelineAgentRuntime & Pick<PipelineExecRuntime, "execSafeFn" | "cwd">,
): Promise<{ report: SkillRecommendationReport; judgeDiagnostics: string[]; stages: StageResult[] }> {
  const enrichedRecommendedSkills = await enrichSkillsCliCandidates(
    report.recommendedSkills,
    pctx.execSafeFn,
    pctx.cwd,
  );
  const enrichedReport: SkillRecommendationReport = {
    ...report,
    recommendedSkills: enrichedRecommendedSkills,
  };

  if (enrichedReport.discoveredSkills.length === 0 && enrichedReport.recommendedSkills.length === 0) {
    return { report: enrichedReport, judgeDiagnostics: [], stages: [] };
  }

  try {
    const { output, stages } = await runSkillJudge(buildRecommendJudgePrompt(enrichedReport), "skill-recommend", pctx);
    const parsed = parseJson<SkillRecommendJudgeOutput>(output);
    const selectedSkills = applyLocalJudgements(
      enrichedReport.discoveredSkills,
      enrichedReport.selectedSkills,
      parsed.selectedLocal ?? [],
    );
    const recommendedSkills = applyExternalJudgements(enrichedReport.recommendedSkills, parsed.selectedExternal ?? []);
    return {
      report: {
        ...enrichedReport,
        selectedSkills,
        recommendedSkills,
        judgeDiagnostics: [],
      },
      judgeDiagnostics: [],
      stages,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      report: {
        ...enrichedReport,
        judgeDiagnostics: [message],
      },
      judgeDiagnostics: [message],
      stages: [],
    };
  }
}
