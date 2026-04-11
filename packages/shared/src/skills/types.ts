export type SkillCommand =
  | "implement"
  | "review"
  | "review-lite"
  | "architecture"
  | "init"
  | "continue"
  | "investigate"
  | "create-gh-issue"
  | "create-gh-issues";

export interface SkillRoot {
  path: string;
  scope: "project" | "global" | "extra";
  harness: "agents" | "pi" | "claude" | "copilot" | "codex" | "opencode" | "custom";
  distance: number;
  precedence: number;
}

export interface DiscoveredSkill {
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
  disableModelInvocation: boolean;
  root: SkillRoot;
}

export interface SkillDuplicate {
  name: string;
  chosen: DiscoveredSkill;
  ignored: DiscoveredSkill[];
}

export interface SkillSignal {
  kind: "dependency" | "manifest" | "config" | "file" | "keyword" | "code";
  value: string;
  reason: string;
  weight: number;
  aliases: string[];
  sourcePath?: string;
}

export interface SelectedSkill {
  name: string;
  description: string;
  filePath: string;
  score: number;
  reasons: string[];
  root: SkillRoot;
}

export interface SkillSelectionInput {
  command: SkillCommand;
  issueText?: string;
  changedFiles?: string[];
  focusPaths?: string[];
  maxSelected?: number;
}

export interface SkillSelectionReport {
  command: SkillCommand;
  rootsScanned: SkillRoot[];
  diagnostics: string[];
  discoveredSkills: DiscoveredSkill[];
  duplicates: SkillDuplicate[];
  repoRoot: string;
  changedFiles: string[];
  focusPaths: string[];
  signals: SkillSignal[];
  selectedSkills: SelectedSkill[];
}

export interface SkillScanReport {
  rootsScanned: SkillRoot[];
  diagnostics: string[];
  discoveredSkills: DiscoveredSkill[];
  duplicates: SkillDuplicate[];
  repoRoot: string;
  analyses: SkillSelectionReport[];
}

export interface SkillLandscape {
  rootsScanned: SkillRoot[];
  diagnostics: string[];
  discoveredSkills: DiscoveredSkill[];
  duplicates: SkillDuplicate[];
}

export interface RepoInventory {
  repoRoot: string;
  manifests: RepoFile[];
}

export interface RepoFile {
  path: string;
  kind:
    | "package-json"
    | "pnpm-workspace"
    | "turbo"
    | "nx"
    | "mix"
    | "pyproject"
    | "go-mod"
    | "cargo"
    | "dotnet-sln"
    | "dotnet-proj"
    | "tailwind-config"
    | "wrangler"
    | "next-config"
    | "nuxt-config"
    | "vite-config"
    | "vitest-config";
}

export interface SkillDetectionContext {
  cwd: string;
  repoRoot: string;
  input: SkillSelectionInput;
  inventory: RepoInventory;
  relevantManifests: RepoFile[];
  changedFiles: string[];
  focusPaths: string[];
}

export interface SkillSignalDetector {
  name: string;
  detect(ctx: SkillDetectionContext): SkillSignal[];
}
