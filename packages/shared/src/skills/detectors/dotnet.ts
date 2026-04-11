import * as fs from "node:fs";
import * as path from "node:path";
import type { SkillDetectionContext, SkillSignalDetector } from "../types.js";
import { SignalBuilder } from "./signal-builder.js";

function extractDotnetDependencies(filePath: string): { deps: string[]; signals: string[] } {
  const raw = fs.readFileSync(filePath, "utf-8");
  const deps = Array.from(
    raw.matchAll(/<PackageReference[^>]*Include="([^"]+)"/g),
    (match) => match[1]?.toLowerCase() ?? "",
  );
  const signals = ["dotnet"];
  const sdk = raw.match(/<Project[^>]*Sdk="([^"]+)"/i)?.[1]?.toLowerCase();
  if (sdk) signals.push(sdk);
  if (sdk?.includes("web")) signals.push("aspnet-core");
  if (raw.includes("<TargetFramework>")) signals.push("dotnet");
  return { deps: Array.from(new Set(deps)), signals: Array.from(new Set(signals)) };
}

export const dotnetDetector: SkillSignalDetector = {
  name: "dotnet",
  detect(ctx: SkillDetectionContext) {
    const signals = new SignalBuilder();

    for (const manifest of ctx.relevantManifests) {
      const rel = path.relative(ctx.repoRoot, manifest.path) || path.basename(manifest.path);
      if (manifest.kind === "dotnet-sln") {
        signals.add({
          kind: "manifest",
          value: "dotnet",
          reason: `${rel}: .sln detected`,
          weight: 3,
          sourcePath: manifest.path,
        });
        continue;
      }

      if (manifest.kind !== "dotnet-proj") continue;
      const dotnet = extractDotnetDependencies(manifest.path);
      for (const dep of dotnet.deps) {
        signals.addDependency(dep, rel, manifest.path);
      }
      for (const value of dotnet.signals) {
        signals.add({
          kind: "manifest",
          value,
          reason: `${rel}: ${path.basename(manifest.path)} indicates ${value}`,
          weight: 3,
          sourcePath: manifest.path,
        });
      }
    }

    return signals.list();
  },
};
