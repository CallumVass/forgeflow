import { aliasesForTerm } from "../text.js";
import type { SkillSignal } from "../types.js";

interface SignalDraft {
  kind: SkillSignal["kind"];
  value: string;
  reason: string;
  weight: number;
  aliases?: string[];
  sourcePath?: string;
}

export class SignalBuilder {
  #signals: SkillSignal[] = [];
  #seen = new Set<string>();

  add(draft: SignalDraft): void {
    const key = `${draft.kind}:${draft.value}:${draft.sourcePath ?? ""}`;
    if (this.#seen.has(key)) return;
    this.#seen.add(key);
    this.#signals.push({
      ...draft,
      aliases: draft.aliases ?? aliasesForTerm(draft.value),
    });
  }

  addDependency(value: string, reasonPrefix: string, sourcePath: string): void {
    this.add({
      kind: "dependency",
      value,
      reason: `${reasonPrefix}: dependency ${value}`,
      weight: 4,
      sourcePath,
    });
  }

  list(): SkillSignal[] {
    return this.#signals;
  }
}
