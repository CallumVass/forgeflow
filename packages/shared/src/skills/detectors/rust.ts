import * as fs from "node:fs";
import * as path from "node:path";
import type { SkillDetectionContext, SkillSignalDetector } from "../types.js";
import { SignalBuilder } from "./signal-builder.js";

function extractCargoDependencies(filePath: string): string[] {
  const raw = fs.readFileSync(filePath, "utf-8");
  const deps = new Set<string>();
  for (const section of ["dependencies", "dev-dependencies", "build-dependencies"]) {
    const match = raw.match(new RegExp(`\\[${section}\\]([\\s\\S]*?)(?:\\n\\[|$)`, "m"));
    if (!match?.[1]) continue;
    for (const line of match[1].split("\n")) {
      const dep = line.match(/^([A-Za-z0-9_.-]+)\s*=/)?.[1];
      if (dep) deps.add(dep.toLowerCase());
    }
  }
  return Array.from(deps);
}

export const rustDetector: SkillSignalDetector = {
  name: "rust",
  detect(ctx: SkillDetectionContext) {
    const signals = new SignalBuilder();

    for (const manifest of ctx.relevantManifests) {
      if (manifest.kind !== "cargo") continue;
      const rel = path.relative(ctx.repoRoot, manifest.path) || path.basename(manifest.path);
      for (const dep of extractCargoDependencies(manifest.path)) {
        signals.addDependency(dep, rel, manifest.path);
      }
      signals.add({
        kind: "manifest",
        value: "rust",
        reason: `${rel}: Cargo.toml detected`,
        weight: 3,
        sourcePath: manifest.path,
      });
    }

    return signals.list();
  },
};
