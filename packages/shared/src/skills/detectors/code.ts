import * as fs from "node:fs";
import * as path from "node:path";
import { collectCandidateCodeFiles } from "../inventory.js";
import type { SkillDetectionContext, SkillSignalDetector } from "../types.js";
import { SignalBuilder } from "./signal-builder.js";

const MAX_FILE_BYTES = 100_000;

function readText(filePath: string): string {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return raw.length > MAX_FILE_BYTES ? raw.slice(0, MAX_FILE_BYTES) : raw;
  } catch {
    return "";
  }
}

function isExternalImport(specifier: string): boolean {
  return specifier.length > 0 && !specifier.startsWith(".") && !specifier.startsWith("/") && !specifier.startsWith("#");
}

function collectImportLikeTerms(filePath: string, text: string): string[] {
  const terms = new Set<string>();
  const ext = path.extname(filePath).toLowerCase();

  for (const match of text.matchAll(/(?:import|export)\s+(?:[^"'\n]+?\s+from\s+)?["']([^"']+)["']/g)) {
    const specifier = match[1]?.trim() ?? "";
    if (isExternalImport(specifier)) terms.add(specifier);
  }
  for (const match of text.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)) {
    const specifier = match[1]?.trim() ?? "";
    if (isExternalImport(specifier)) terms.add(specifier);
  }

  if (ext === ".cs") {
    for (const match of text.matchAll(/^\s*using\s+([A-Za-z0-9_.]+)/gm)) {
      const specifier = match[1]?.trim() ?? "";
      if (isExternalImport(specifier)) terms.add(specifier);
    }
  }

  if (ext === ".go") {
    for (const match of text.matchAll(/"([^"]+)"/g)) {
      const specifier = match[1]?.trim() ?? "";
      if (isExternalImport(specifier)) terms.add(specifier);
    }
  }

  if (ext === ".py") {
    for (const match of text.matchAll(/^\s*import\s+([A-Za-z0-9_.]+)/gm)) {
      const specifier = match[1]?.trim() ?? "";
      if (isExternalImport(specifier)) terms.add(specifier);
    }
    for (const match of text.matchAll(/^\s*from\s+([A-Za-z0-9_.]+)\s+import\s+/gm)) {
      const specifier = match[1]?.trim() ?? "";
      if (isExternalImport(specifier)) terms.add(specifier);
    }
  }

  if (ext === ".ex" || ext === ".exs") {
    for (const match of text.matchAll(/^\s*(?:use|alias|import)\s+([A-Za-z0-9_.]+)/gm)) {
      const specifier = match[1]?.trim() ?? "";
      if (isExternalImport(specifier)) terms.add(specifier);
    }
  }

  return Array.from(terms);
}

function hasUtilityClassPattern(text: string): boolean {
  const classRe = /class(?:Name)?\s*=\s*["'`]([^"'`]+)["'`]/g;
  for (const match of text.matchAll(classRe)) {
    const value = match[1]?.trim() ?? "";
    if (!value) continue;
    const tokens = value.split(/\s+/).filter(Boolean);
    const utilityish = tokens.filter((token) => /^(?:[a-z]+:)?[a-z0-9-]+(?:\[[^\]]+\])?$/.test(token));
    const withTailwindShape = utilityish.filter(
      (token) =>
        token.includes(":") || token.includes("[") || token.includes("-") || /^(flex|grid|block|hidden)$/.test(token),
    );
    if (tokens.length >= 4 && utilityish.length >= 4 && withTailwindShape.length >= 3) return true;
  }
  return false;
}

export const codePatternDetector: SkillSignalDetector = {
  name: "code-patterns",
  detect(ctx: SkillDetectionContext) {
    const signals = new SignalBuilder();
    const files = collectCandidateCodeFiles(ctx.repoRoot, ctx.focusPaths, ctx.focusPaths.length > 0 ? 40 : 80);
    const counts = new Map<string, number>();
    let utilityClassFiles = 0;

    for (const filePath of files) {
      const text = readText(filePath);
      if (!text) continue;
      for (const term of collectImportLikeTerms(filePath, text)) {
        counts.set(term, (counts.get(term) ?? 0) + 1);
      }
      if (hasUtilityClassPattern(text)) utilityClassFiles++;
    }

    for (const [term, count] of counts.entries()) {
      const weight = count >= 4 ? 4 : count >= 2 ? 3 : 2;
      signals.add({
        kind: "code",
        value: term,
        reason: `Code patterns import or reference ${term}${count > 1 ? ` in ${count} files` : ""}`,
        weight,
      });
    }

    if (utilityClassFiles > 0) {
      signals.add({
        kind: "code",
        value: "tailwindcss",
        reason: `Code patterns include utility-class-heavy className strings${utilityClassFiles > 1 ? ` in ${utilityClassFiles} files` : ""}`,
        weight: utilityClassFiles >= 3 ? 3 : 2,
      });
    }

    return signals.list();
  },
};
