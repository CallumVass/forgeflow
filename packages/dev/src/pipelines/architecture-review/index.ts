/**
 * A single architectural finding parsed from reviewer output: a short label
 * (e.g. "1. High coupling in auth module") and the full markdown body.
 */
export type ArchitectureCandidate = { label: string; body: string };

/**
 * Parse numbered candidates from the architecture reviewer output.
 * Matches headings like "### 1. Short name" or "**1. Short name**".
 */
export function parseCandidates(text: string): ArchitectureCandidate[] {
  const pattern = /^(?:#{1,4}\s+)?(\d+)\.\s+(.+)$/gm;
  const matches = [...text.matchAll(pattern)];
  if (matches.length === 0) return [];

  const results: ArchitectureCandidate[] = [];
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i] as RegExpMatchArray;
    const num = match[1] as string;
    const name = (match[2] as string).replace(/[*#]+/g, "").trim();
    const start = match.index as number;
    const end = i + 1 < matches.length ? ((matches[i + 1] as RegExpMatchArray).index as number) : text.length;
    const body = text.slice(start, end).trim();
    results.push({ label: `${num}. ${name}`, body });
  }

  return results;
}
