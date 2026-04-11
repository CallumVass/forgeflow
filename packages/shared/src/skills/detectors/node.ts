import * as fs from "node:fs";
import type { RepoFile, SkillDetectionContext, SkillSignalDetector } from "../types.js";
import { SignalBuilder } from "./signal-builder.js";

function extractJsonDependencies(filePath: string): string[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<string, unknown>;
    const blocks = [parsed.dependencies, parsed.devDependencies, parsed.peerDependencies, parsed.optionalDependencies];
    const names: string[] = [];
    for (const block of blocks) {
      if (!block || typeof block !== "object" || Array.isArray(block)) continue;
      names.push(...Object.keys(block));
    }
    return Array.from(new Set(names));
  } catch {
    return [];
  }
}

function detectConfigValue(kind: RepoFile["kind"]): string | undefined {
  switch (kind) {
    case "pnpm-workspace":
      return "pnpm-workspace";
    case "turbo":
      return "turbo";
    case "nx":
      return "nx";
    case "tailwind-config":
      return "tailwindcss";
    case "next-config":
      return "nextjs";
    case "nuxt-config":
      return "nuxt";
    case "vite-config":
      return "vite";
    case "vitest-config":
      return "vitest";
    default:
      return undefined;
  }
}

export const nodeDetector: SkillSignalDetector = {
  name: "node",
  detect(ctx: SkillDetectionContext) {
    const signals = new SignalBuilder();

    for (const manifest of ctx.relevantManifests) {
      const rel = manifest.path.startsWith(ctx.repoRoot) ? manifest.path.slice(ctx.repoRoot.length + 1) : manifest.path;
      if (manifest.kind === "package-json") {
        for (const dep of extractJsonDependencies(manifest.path)) {
          signals.addDependency(dep, rel || manifest.path, manifest.path);
        }
        const raw = fs.readFileSync(manifest.path, "utf-8");
        if (raw.includes('"workspaces"')) {
          signals.add({
            kind: "manifest",
            value: "monorepo",
            reason: `${rel || manifest.path}: package.json declares workspaces`,
            weight: 2,
            aliases: ["workspace", "monorepo"],
            sourcePath: manifest.path,
          });
        }
        continue;
      }

      const configValue = detectConfigValue(manifest.kind);
      if (!configValue) continue;
      signals.add({
        kind: "config",
        value: configValue,
        reason: `${rel || manifest.path}: ${manifest.path.split(/[\\/]/).pop()} detected`,
        weight: 5,
        sourcePath: manifest.path,
      });
    }

    return signals.list();
  },
};
