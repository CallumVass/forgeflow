import { containsAlias, normaliseText, uniqueStrings } from "./text.js";
import type { DiscoveredSkill, SelectedSkill, SkillSignal } from "./types.js";

function scoreSkill(skill: DiscoveredSkill, signals: SkillSignal[]): SelectedSkill | undefined {
  let score = 0;
  const reasons: string[] = [];
  const nameText = normaliseText(skill.name);
  const descText = normaliseText(skill.description);
  const pathText = normaliseText(skill.filePath);

  for (const signal of signals) {
    let matched = false;
    for (const alias of signal.aliases) {
      if (containsAlias(nameText, alias)) {
        score += signal.weight * 5;
        matched = true;
        break;
      }
      if (containsAlias(pathText, alias)) {
        score += signal.weight * 4;
        matched = true;
        break;
      }
      if (containsAlias(descText, alias)) {
        score += signal.weight * 3;
        matched = true;
        break;
      }
    }
    if (matched) reasons.push(signal.reason);
  }

  if (skill.root.scope === "project") score += 2;
  if (skill.root.scope === "extra") score += 1;
  if (score <= 0) return undefined;

  return {
    name: skill.name,
    description: skill.description,
    filePath: skill.filePath,
    score,
    reasons: uniqueStrings(reasons).slice(0, 4),
    root: skill.root,
  };
}

export function selectSkills(skills: DiscoveredSkill[], signals: SkillSignal[], maxSelected: number): SelectedSkill[] {
  return skills
    .map((skill) => scoreSkill(skill, signals))
    .filter((skill): skill is SelectedSkill => Boolean(skill))
    .sort((a, b) => b.score - a.score || b.root.precedence - a.root.precedence || a.name.localeCompare(b.name))
    .slice(0, Math.max(0, maxSelected));
}
