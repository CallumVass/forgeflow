import * as fs from "node:fs";
import * as path from "node:path";
import { fileExists, findRepoRoot } from "./fs.js";
import { uniqueStrings } from "./text.js";
import type { RepoFile, RepoInventory, SkillSelectionInput } from "./types.js";

const SKIP_DIRS = new Set([
  ".git",
  ".hg",
  ".svn",
  ".agents",
  ".claude",
  ".codex",
  ".copilot",
  ".opencode",
  ".pi",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".turbo",
  ".parcel-cache",
  ".venv",
  "venv",
  "vendor",
  "target",
  "bin",
  "obj",
]);

function shouldSkipDir(entryPath: string): boolean {
  const name = path.basename(entryPath);
  return SKIP_DIRS.has(name);
}

function classifyRepoFile(filePath: string): RepoFile["kind"] | undefined {
  const base = path.basename(filePath);
  if (base === "package.json") return "package-json";
  if (base === "pnpm-workspace.yaml") return "pnpm-workspace";
  if (base === "turbo.json") return "turbo";
  if (base === "nx.json") return "nx";
  if (base === "mix.exs") return "mix";
  if (base === "pyproject.toml") return "pyproject";
  if (base === "go.mod") return "go-mod";
  if (base === "Cargo.toml") return "cargo";
  if (/\.sln$/i.test(base)) return "dotnet-sln";
  if (/\.(cs|fs|vb)proj$/i.test(base)) return "dotnet-proj";
  if (/^tailwind\.config\.(js|ts|cjs|mjs)$/i.test(base)) return "tailwind-config";
  if (/^wrangler\.(toml|json|jsonc)$/i.test(base)) return "wrangler";
  if (/^next\.config\.(js|ts|cjs|mjs)$/i.test(base)) return "next-config";
  if (/^nuxt\.config\.(js|ts|cjs|mjs)$/i.test(base)) return "nuxt-config";
  if (/^(vite|vitest)\.config\.(js|ts|cjs|mjs)$/i.test(base)) {
    return base.startsWith("vitest") ? "vitest-config" : "vite-config";
  }
  return undefined;
}

function walkRepo(current: string, files: RepoFile[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(current, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      if (shouldSkipDir(fullPath)) continue;
      walkRepo(fullPath, files);
      continue;
    }
    const kind = classifyRepoFile(fullPath);
    if (kind) files.push({ path: fullPath, kind });
  }
}

export function scanRepository(cwd: string): RepoInventory {
  const repoRoot = findRepoRoot(cwd);
  const manifests: RepoFile[] = [];
  if (fileExists(repoRoot)) walkRepo(repoRoot, manifests);
  return { repoRoot, manifests };
}

export function collectFocusPaths(
  input: SkillSelectionInput,
  cwd: string,
): { changedFiles: string[]; focusPaths: string[] } {
  const changedFiles = uniqueStrings((input.changedFiles ?? []).map((file) => path.resolve(cwd, file)));
  const focusPaths = uniqueStrings((input.focusPaths ?? []).map((file) => path.resolve(cwd, file)));
  if (changedFiles.length > 0) return { changedFiles, focusPaths: [...focusPaths, ...changedFiles] };
  return { changedFiles, focusPaths: focusPaths.length > 0 ? focusPaths : [path.resolve(cwd)] };
}

function isAncestor(ancestor: string, target: string): boolean {
  const rel = path.relative(ancestor, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export function pickRelevantManifests(inventory: RepoInventory, focusPaths: string[]): RepoFile[] {
  if (focusPaths.length === 0) return inventory.manifests;
  const matches = inventory.manifests.filter((manifest) =>
    focusPaths.some((focus) => isAncestor(path.dirname(manifest.path), focus)),
  );
  if (matches.length > 0) return matches;
  return inventory.manifests.filter((manifest) => path.dirname(manifest.path) === inventory.repoRoot);
}

const CODE_FILE_RE = /\.(tsx?|jsx?|mjs|cjs|cs|go|py|rs|exs?)$/i;

function isCodeFile(filePath: string): boolean {
  return CODE_FILE_RE.test(filePath);
}

function resolveScanRoots(repoRoot: string, focusPaths: string[]): string[] {
  const roots = focusPaths.length > 0 ? focusPaths : [repoRoot];
  const normalised = roots.map((root) => path.resolve(root));
  normalised.sort((a, b) => a.length - b.length);
  const deduped: string[] = [];
  for (const root of normalised) {
    if (deduped.some((existing) => isAncestor(existing, root))) continue;
    deduped.push(root);
  }
  return deduped;
}

function walkCodeFiles(current: string, files: string[], limit: number): void {
  if (files.length >= limit) return;
  let stat: fs.Stats;
  try {
    stat = fs.statSync(current);
  } catch {
    return;
  }

  if (stat.isFile()) {
    if (isCodeFile(current)) files.push(current);
    return;
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(current, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (files.length >= limit) return;
    const fullPath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      if (shouldSkipDir(fullPath)) continue;
      walkCodeFiles(fullPath, files, limit);
      continue;
    }
    if (isCodeFile(fullPath)) files.push(fullPath);
  }
}

export function collectCandidateCodeFiles(repoRoot: string, focusPaths: string[], limit = 80): string[] {
  const files: string[] = [];
  for (const root of resolveScanRoots(repoRoot, focusPaths)) {
    walkCodeFiles(root, files, limit);
    if (files.length >= limit) break;
  }
  return uniqueStrings(files).slice(0, limit);
}
