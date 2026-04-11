import * as path from "node:path";
import type { SkillDetectionContext, SkillSignalDetector } from "../types.js";
import { SignalBuilder } from "./signal-builder.js";

export const cloudflareDetector: SkillSignalDetector = {
  name: "cloudflare",
  detect(ctx: SkillDetectionContext) {
    const signals = new SignalBuilder();

    for (const manifest of ctx.relevantManifests) {
      if (manifest.kind !== "wrangler") continue;
      const rel = path.relative(ctx.repoRoot, manifest.path) || path.basename(manifest.path);
      signals.add({
        kind: "config",
        value: "cloudflare",
        reason: `${rel}: ${path.basename(manifest.path)} detected`,
        weight: 5,
        sourcePath: manifest.path,
      });
    }

    return signals.list();
  },
};
