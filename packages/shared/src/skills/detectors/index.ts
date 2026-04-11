import { collectFocusPaths, pickRelevantManifests } from "../inventory.js";
import type {
  RepoInventory,
  SkillDetectionContext,
  SkillSelectionInput,
  SkillSignal,
  SkillSignalDetector,
} from "../types.js";
import { cloudflareDetector } from "./cloudflare.js";
import { codePatternDetector } from "./code.js";
import { dotnetDetector } from "./dotnet.js";
import { elixirDetector } from "./elixir.js";
import { changedFilesDetector } from "./files.js";
import { goDetector } from "./go.js";
import { keywordDetector } from "./keywords.js";
import { nodeDetector } from "./node.js";
import { pythonDetector } from "./python.js";
import { rustDetector } from "./rust.js";

const DEFAULT_DETECTORS: SkillSignalDetector[] = [
  nodeDetector,
  dotnetDetector,
  elixirDetector,
  pythonDetector,
  goDetector,
  rustDetector,
  cloudflareDetector,
  changedFilesDetector,
  codePatternDetector,
  keywordDetector,
];

function buildDetectionContext(
  cwd: string,
  inventory: RepoInventory,
  input: SkillSelectionInput,
): SkillDetectionContext {
  const { changedFiles, focusPaths } = collectFocusPaths(input, cwd);
  return {
    cwd,
    repoRoot: inventory.repoRoot,
    input,
    inventory,
    relevantManifests: pickRelevantManifests(inventory, focusPaths),
    changedFiles,
    focusPaths,
  };
}

interface SkillSignalAnalysis {
  repoRoot: string;
  changedFiles: string[];
  focusPaths: string[];
  signals: SkillSignal[];
  detectorNames: string[];
}

function dedupeSignals(signals: SkillSignal[]): SkillSignal[] {
  const seen = new Set<string>();
  const out: SkillSignal[] = [];
  for (const signal of signals) {
    const key = `${signal.kind}:${signal.value}:${signal.sourcePath ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(signal);
  }
  return out;
}

export function detectSkillSignals(
  cwd: string,
  inventory: RepoInventory,
  input: SkillSelectionInput,
  detectors: SkillSignalDetector[] = DEFAULT_DETECTORS,
): SkillSignalAnalysis {
  const ctx = buildDetectionContext(cwd, inventory, input);
  const signals = dedupeSignals(detectors.flatMap((detector) => detector.detect(ctx)));
  return {
    repoRoot: ctx.repoRoot,
    changedFiles: ctx.changedFiles,
    focusPaths: ctx.focusPaths,
    signals,
    detectorNames: detectors.map((detector) => detector.name),
  };
}

export { DEFAULT_DETECTORS };
