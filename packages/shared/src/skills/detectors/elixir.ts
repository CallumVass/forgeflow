import * as fs from "node:fs";
import * as path from "node:path";
import type { SkillDetectionContext, SkillSignalDetector } from "../types.js";
import { SignalBuilder } from "./signal-builder.js";

function extractMixDependencies(filePath: string): string[] {
  const raw = fs.readFileSync(filePath, "utf-8");
  const names = Array.from(raw.matchAll(/\{\s*:([a-zA-Z0-9_]+)/g), (match) => match[1]?.replace(/_/g, "-") ?? "");
  return Array.from(new Set(names));
}

export const elixirDetector: SkillSignalDetector = {
  name: "elixir",
  detect(ctx: SkillDetectionContext) {
    const signals = new SignalBuilder();

    for (const manifest of ctx.relevantManifests) {
      if (manifest.kind !== "mix") continue;
      const rel = path.relative(ctx.repoRoot, manifest.path) || path.basename(manifest.path);
      for (const dep of extractMixDependencies(manifest.path)) {
        signals.addDependency(dep, rel, manifest.path);
      }
      signals.add({
        kind: "manifest",
        value: "elixir",
        reason: `${rel}: mix.exs detected`,
        weight: 3,
        sourcePath: manifest.path,
      });
    }

    return signals.list();
  },
};
