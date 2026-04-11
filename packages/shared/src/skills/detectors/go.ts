import * as fs from "node:fs";
import * as path from "node:path";
import type { SkillDetectionContext, SkillSignalDetector } from "../types.js";
import { SignalBuilder } from "./signal-builder.js";

function extractGoDependencies(filePath: string): string[] {
  const raw = fs.readFileSync(filePath, "utf-8");
  const deps = new Set<string>();
  for (const match of raw.matchAll(/^\s*require\s+([^\s]+)|^\s*([^\s]+)\s+v[0-9]/gm)) {
    const dep = match[1] ?? match[2];
    if (dep) deps.add(dep.toLowerCase());
  }
  return Array.from(deps);
}

export const goDetector: SkillSignalDetector = {
  name: "go",
  detect(ctx: SkillDetectionContext) {
    const signals = new SignalBuilder();

    for (const manifest of ctx.relevantManifests) {
      if (manifest.kind !== "go-mod") continue;
      const rel = path.relative(ctx.repoRoot, manifest.path) || path.basename(manifest.path);
      for (const dep of extractGoDependencies(manifest.path)) {
        signals.addDependency(dep, rel, manifest.path);
      }
      signals.add({
        kind: "manifest",
        value: "go",
        reason: `${rel}: go.mod detected`,
        weight: 3,
        sourcePath: manifest.path,
      });
    }

    return signals.list();
  },
};
