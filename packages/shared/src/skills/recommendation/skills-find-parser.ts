import type { ExternalSkillCandidate } from "../types.js";

function stripAnsi(value: string): string {
  let out = "";
  for (let index = 0; index < value.length; index++) {
    const current = value[index];
    if (current === "\u001b" && value[index + 1] === "[") {
      index += 2;
      while (index < value.length) {
        const code = value.charCodeAt(index);
        if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122)) break;
        index++;
      }
      continue;
    }
    out += current;
  }
  return out;
}

function parseCompactNumber(value: string | undefined): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d+(?:\.\d+)?)([KMB])?$/i);
  if (!match) return Number.isFinite(Number(trimmed)) ? Number(trimmed) : null;
  const base = Number(match[1]);
  const suffix = match[2]?.toUpperCase();
  const multiplier = suffix === "K" ? 1_000 : suffix === "M" ? 1_000_000 : suffix === "B" ? 1_000_000_000 : 1;
  return Math.round(base * multiplier);
}

function skillSlugFromId(id: string): string {
  const at = id.indexOf("@");
  return at >= 0 ? id.slice(at + 1) : id;
}

function repositoryFromId(id: string): string | undefined {
  const at = id.indexOf("@");
  return at >= 0 ? id.slice(0, at) : undefined;
}

export function parseSkillsFindOutput(output: string): ExternalSkillCandidate[] {
  const lines = stripAnsi(output)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.some((line) => line.startsWith('No skills found for "'))) return [];

  const candidates: ExternalSkillCandidate[] = [];
  let pending: ExternalSkillCandidate | undefined;

  for (const line of lines) {
    if (line.startsWith("Install with")) continue;
    if (line.startsWith("└ ")) {
      if (pending) {
        candidates.push({ ...pending, url: line.replace(/^└\s*/, "").trim() });
        pending = undefined;
      }
      continue;
    }

    const match = line.match(/^(\S+?)(?:\s+([0-9][0-9.,]*\s*[KMB]?)\s+installs)?$/i);
    const id = match?.[1];
    if (!id) continue;
    pending = {
      id,
      slug: skillSlugFromId(id),
      repository: repositoryFromId(id),
      url: "",
      installs: parseCompactNumber(match?.[2]?.replace(/,/g, "").replace(/\s+/g, "")),
      installsLabel: match?.[2] ? `${match[2].trim()} installs` : undefined,
    };
  }

  if (pending) candidates.push(pending);

  return candidates;
}
