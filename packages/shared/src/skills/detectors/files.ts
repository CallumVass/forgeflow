import * as path from "node:path";
import type { SkillDetectionContext, SkillSignalDetector } from "../types.js";
import { SignalBuilder } from "./signal-builder.js";

export const changedFilesDetector: SkillSignalDetector = {
  name: "changed-files",
  detect(ctx: SkillDetectionContext) {
    const signals = new SignalBuilder();

    for (const filePath of ctx.changedFiles) {
      const rel = path.relative(ctx.repoRoot, filePath) || filePath;
      const ext = path.extname(filePath).toLowerCase();
      const fileSignals: string[] = [];
      if (ext === ".cs") fileSignals.push("dotnet", "csharp");
      if (ext === ".tsx" || ext === ".jsx") fileSignals.push("react", "typescript");
      if (ext === ".ts") fileSignals.push("typescript");
      if (ext === ".ex" || ext === ".exs") fileSignals.push("elixir");
      if (ext === ".go") fileSignals.push("go");
      if (ext === ".rs") fileSignals.push("rust");
      if (filePath.includes(`${path.sep}routes${path.sep}`)) fileSignals.push("router");
      if (filePath.includes("tailwind")) fileSignals.push("tailwindcss");
      for (const value of fileSignals) {
        signals.add({
          kind: "file",
          value,
          reason: `${rel}: changed file suggests ${value}`,
          weight: 2,
          sourcePath: filePath,
        });
      }
    }

    return signals.list();
  },
};
