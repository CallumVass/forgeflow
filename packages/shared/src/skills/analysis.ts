import type { SkillsConfig } from "../config/forgeflow-config.js";
import { detectSkillSignals } from "./detectors/index.js";
import { scanRepository } from "./inventory.js";
import { selectSkills } from "./matcher.js";
import { discoverSkillLandscape } from "./roots.js";
import type { SelectedSkill, SkillLandscape, SkillSelectionInput } from "./types.js";

interface SkillSelectionAnalysis {
  landscape: SkillLandscape;
  analysed: ReturnType<typeof detectSkillSignals>;
  selectedSkills: SelectedSkill[];
}

export async function analyseSkillSelection(
  cwd: string,
  config: SkillsConfig,
  input: SkillSelectionInput,
): Promise<SkillSelectionAnalysis> {
  const landscape = await discoverSkillLandscape(cwd, config);
  const inventory = scanRepository(cwd);
  const analysed = detectSkillSignals(cwd, inventory, input);
  const selectedSkills = config.enabled
    ? selectSkills(landscape.discoveredSkills, analysed.signals, input.maxSelected ?? config.maxSelected)
    : [];

  return {
    landscape,
    analysed,
    selectedSkills,
  };
}
