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

export interface SkillJudgement {
  confidence: number;
  reason: string;
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
  judgement?: SkillJudgement;
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
  judgeDiagnostics?: string[];
}

export interface SkillSearchQuery {
  query: string;
  weight: number;
  reasons: string[];
}

export interface ExternalSkillCandidate {
  id: string;
  slug: string;
  url: string;
  installs: number | null;
  installsLabel?: string;
  repository?: string;
  description?: string;
}

export interface QueriedExternalSkillCandidate extends ExternalSkillCandidate {
  matchedQueries: string[];
}

export interface RecommendedExternalSkill extends QueriedExternalSkillCandidate {
  provider: string;
  installCommand: string;
  score: number;
  reasons: string[];
  judgement?: SkillJudgement;
}

export interface SkillRecommendationProviderResult {
  provider: string;
  diagnostics: string[];
  candidates: QueriedExternalSkillCandidate[];
}

export interface SkillRecommendationProvider {
  name: string;
  search(queries: SkillSearchQuery[]): Promise<SkillRecommendationProviderResult>;
}

export interface SkillRecommendationReport {
  command: SkillCommand;
  rootsScanned: SkillRoot[];
  diagnostics: string[];
  providerDiagnostics: string[];
  provider: string;
  discoveredSkills: DiscoveredSkill[];
  duplicates: SkillDuplicate[];
  repoRoot: string;
  changedFiles: string[];
  focusPaths: string[];
  signals: SkillSignal[];
  selectedSkills: SelectedSkill[];
  searchQueries: SkillSearchQuery[];
  recommendedSkills: RecommendedExternalSkill[];
  skippedInstalledSkillNames: string[];
  judgeDiagnostics?: string[];
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
