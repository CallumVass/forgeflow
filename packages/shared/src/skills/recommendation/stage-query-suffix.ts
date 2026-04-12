import type { SkillCommand } from "../types.js";

export const STAGE_QUERY_SUFFIX: Partial<Record<SkillCommand, string>> = {
  review: "review",
  "review-lite": "review",
  architecture: "architecture",
};
