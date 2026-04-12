import type { ExecFn } from "../../io/index.js";
import type { ExternalSkillCandidate } from "../types.js";
import { parseSkillsListOutput } from "./skills-list-parser.js";

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `"'"'"`)}'`;
}

function mergeCandidateDescription<T extends ExternalSkillCandidate>(
  candidate: T,
  descriptionsBySlug: Map<string, string>,
): T {
  const description = descriptionsBySlug.get(candidate.slug) ?? candidate.description;
  return description ? { ...candidate, description } : candidate;
}

export async function enrichSkillsCliCandidates<T extends ExternalSkillCandidate>(
  candidates: T[],
  execSafeFn: ExecFn,
  cwd: string,
): Promise<T[]> {
  const repositories = Array.from(
    new Set(candidates.map((candidate) => candidate.repository).filter((value): value is string => Boolean(value))),
  );
  if (repositories.length === 0) return candidates;

  const descriptionsByRepository = new Map<string, Map<string, string>>();
  for (const repository of repositories) {
    const output = await execSafeFn(`npx --yes skills add ${shellQuote(repository)} --list -y`, cwd);
    if (!output) continue;
    descriptionsByRepository.set(
      repository,
      new Map(parseSkillsListOutput(output).map((entry) => [entry.slug, entry.description])),
    );
  }

  return candidates.map((candidate) => {
    const repository = candidate.repository;
    if (!repository) return candidate;
    const descriptionsBySlug = descriptionsByRepository.get(repository);
    if (!descriptionsBySlug) return candidate;
    return mergeCandidateDescription(candidate, descriptionsBySlug);
  });
}
