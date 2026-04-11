import { extractSearchPhrases } from "../text.js";
import type { SkillDetectionContext, SkillSignalDetector } from "../types.js";
import { SignalBuilder } from "./signal-builder.js";

export const keywordDetector: SkillSignalDetector = {
  name: "keywords",
  detect(ctx: SkillDetectionContext) {
    if (!ctx.input.issueText) return [];
    const signals = new SignalBuilder();

    for (const phrase of extractSearchPhrases(ctx.input.issueText)) {
      signals.add({
        kind: "keyword",
        value: phrase,
        reason: `Issue text suggests ${phrase}`,
        weight: phrase.includes(" ") ? 2 : 1,
      });
    }

    return signals.list();
  },
};
