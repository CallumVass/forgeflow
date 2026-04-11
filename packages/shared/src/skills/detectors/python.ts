import * as fs from "node:fs";
import * as path from "node:path";
import type { SkillDetectionContext, SkillSignalDetector } from "../types.js";
import { SignalBuilder } from "./signal-builder.js";

function extractPyprojectDependencies(filePath: string): string[] {
  const raw = fs.readFileSync(filePath, "utf-8");
  const deps = new Set<string>();
  for (const match of raw.matchAll(/"([A-Za-z0-9_.-]+)(?:\[[^\]]+\])?(?:[<>=!~].*?)?"/g)) {
    const dep = match[1];
    if (dep) deps.add(dep.toLowerCase());
  }
  const poetry = raw.match(/\[tool\.poetry\.dependencies\]([\s\S]*?)(?:\n\[|$)/);
  if (poetry?.[1]) {
    for (const line of poetry[1].split("\n")) {
      const match = line.match(/^([A-Za-z0-9_.-]+)\s*=/);
      if (match?.[1] && match[1] !== "python") deps.add(match[1].toLowerCase());
    }
  }
  return Array.from(deps);
}

export const pythonDetector: SkillSignalDetector = {
  name: "python",
  detect(ctx: SkillDetectionContext) {
    const signals = new SignalBuilder();

    for (const manifest of ctx.relevantManifests) {
      if (manifest.kind !== "pyproject") continue;
      const rel = path.relative(ctx.repoRoot, manifest.path) || path.basename(manifest.path);
      for (const dep of extractPyprojectDependencies(manifest.path)) {
        signals.addDependency(dep, rel, manifest.path);
      }
      signals.add({
        kind: "manifest",
        value: "python",
        reason: `${rel}: pyproject.toml detected`,
        weight: 3,
        sourcePath: manifest.path,
      });
    }

    return signals.list();
  },
};
