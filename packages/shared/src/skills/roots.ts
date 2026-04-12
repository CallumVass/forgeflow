import * as os from "node:os";
import * as path from "node:path";
import { loadSkills, type Skill } from "@mariozechner/pi-coding-agent";
import type { SkillsConfig } from "../config/forgeflow-config.js";
import { collectAncestors, expandHome, fileExists, findRepoRoot, safeRealpath } from "./fs.js";
import type { DiscoveredSkill, SkillDuplicate, SkillLandscape, SkillRoot } from "./types.js";

const PROJECT_ROOTS: Array<{ rel: string; harness: SkillRoot["harness"] }> = [
  { rel: ".agents/skills", harness: "agents" },
  { rel: ".pi/skills", harness: "pi" },
  { rel: ".claude/skills", harness: "claude" },
  { rel: ".copilot/skills", harness: "copilot" },
  { rel: ".codex/skills", harness: "codex" },
  { rel: ".opencode/skills", harness: "opencode" },
];

const GLOBAL_ROOTS: Array<{ rel: string; harness: SkillRoot["harness"] }> = [
  { rel: ".agents/skills", harness: "agents" },
  { rel: ".pi/agent/skills", harness: "pi" },
  { rel: ".claude/skills", harness: "claude" },
  { rel: ".copilot/skills", harness: "copilot" },
  { rel: ".codex/skills", harness: "codex" },
  { rel: ".opencode/skills", harness: "opencode" },
];

function rootPrecedence(scope: SkillRoot["scope"], harness: SkillRoot["harness"], distance: number, index = 0): number {
  const harnessRank = { agents: 0, pi: 1, claude: 2, copilot: 3, codex: 4, opencode: 5, custom: 6 }[harness];
  if (scope === "extra") return 30_000 - index;
  if (scope === "project") return 20_000 - distance * 100 - harnessRank;
  return 10_000 - harnessRank;
}

function toDiscoveredSkill(skill: Skill, root: SkillRoot): DiscoveredSkill {
  return {
    name: skill.name,
    description: skill.description,
    filePath: safeRealpath(skill.filePath),
    baseDir: safeRealpath(skill.baseDir),
    disableModelInvocation: skill.disableModelInvocation,
    root,
  };
}

function discoverSkillRoots(cwd: string, config: SkillsConfig): SkillRoot[] {
  const repoRoot = findRepoRoot(cwd);
  const ancestors = collectAncestors(cwd, repoRoot);
  const roots: SkillRoot[] = [];

  ancestors.forEach((dir, distance) => {
    for (const def of PROJECT_ROOTS) {
      const rootPath = path.join(dir, def.rel);
      if (!fileExists(rootPath)) continue;
      roots.push({
        path: rootPath,
        scope: "project",
        harness: def.harness,
        distance,
        precedence: rootPrecedence("project", def.harness, distance),
      });
    }
  });

  const home = os.homedir();
  GLOBAL_ROOTS.forEach((def) => {
    const rootPath = path.join(home, def.rel);
    if (!fileExists(rootPath)) return;
    roots.push({
      path: rootPath,
      scope: "global",
      harness: def.harness,
      distance: Number.POSITIVE_INFINITY,
      precedence: rootPrecedence("global", def.harness, Number.POSITIVE_INFINITY),
    });
  });

  config.extraPaths.forEach((rootPath, index) => {
    const resolved = path.resolve(expandHome(rootPath));
    if (!fileExists(resolved)) return;
    roots.push({
      path: resolved,
      scope: "extra",
      harness: "custom",
      distance: 0,
      precedence: rootPrecedence("extra", "custom", 0, index),
    });
  });

  roots.sort((a, b) => b.precedence - a.precedence || a.path.localeCompare(b.path));

  const seen = new Set<string>();
  return roots.filter((root) => {
    const real = safeRealpath(root.path);
    if (seen.has(real)) return false;
    seen.add(real);
    return true;
  });
}

export async function discoverSkillLandscape(cwd: string, config: SkillsConfig): Promise<SkillLandscape> {
  const rootsScanned = discoverSkillRoots(cwd, config);
  const diagnostics: string[] = [];
  const allSkills: DiscoveredSkill[] = [];
  const seenPaths = new Set<string>();

  for (const root of rootsScanned) {
    const result = loadSkills({ cwd, includeDefaults: false, skillPaths: [root.path] });
    diagnostics.push(
      ...result.diagnostics.map((diag) => {
        const location = typeof diag.path === "string" && diag.path.length > 0 ? ` (${diag.path})` : "";
        return `${diag.type}: ${diag.message}${location}`;
      }),
    );
    for (const skill of result.skills) {
      const discovered = toDiscoveredSkill(skill, root);
      if (seenPaths.has(discovered.filePath)) continue;
      seenPaths.add(discovered.filePath);
      allSkills.push(discovered);
    }
  }

  allSkills.sort((a, b) => b.root.precedence - a.root.precedence || a.filePath.localeCompare(b.filePath));

  const winners = new Map<string, DiscoveredSkill>();
  const duplicates = new Map<string, SkillDuplicate>();
  for (const skill of allSkills) {
    const existing = winners.get(skill.name);
    if (!existing) {
      winners.set(skill.name, skill);
      continue;
    }
    const dup = duplicates.get(skill.name) ?? { name: skill.name, chosen: existing, ignored: [] };
    dup.ignored.push(skill);
    duplicates.set(skill.name, dup);
  }

  return {
    rootsScanned,
    diagnostics,
    discoveredSkills: Array.from(winners.values()),
    duplicates: Array.from(duplicates.values()),
  };
}
