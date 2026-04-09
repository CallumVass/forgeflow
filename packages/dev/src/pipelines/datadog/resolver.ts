import * as fs from "node:fs/promises";
import * as path from "node:path";

export interface LambdaCandidate {
  file: string;
  line: number;
  functionName?: string;
  constructId?: string;
  handler?: string;
  entry?: string;
  score: number;
  reasons: string[];
}

interface LambdaResolution {
  selected?: LambdaCandidate;
  candidates: LambdaCandidate[];
  ambiguous: boolean;
}

const CODE_FILE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const IGNORE_DIRS = new Set(["node_modules", ".git", ".next", "dist", "build", ".forgeflow"]);

function isCodeFile(filePath: string): boolean {
  return CODE_FILE_EXTENSIONS.has(path.extname(filePath));
}

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORE_DIRS.has(entry.name)) await walk(fullPath, out);
      continue;
    }
    if (entry.isFile() && isCodeFile(fullPath)) out.push(fullPath);
  }
  return out;
}

function pushCandidate(candidates: LambdaCandidate[], next: Omit<LambdaCandidate, "score" | "reasons">): void {
  const existing = candidates.find(
    (candidate) =>
      candidate.file === next.file &&
      ((candidate.functionName && next.functionName && candidate.functionName === next.functionName) ||
        (candidate.constructId && next.constructId && candidate.constructId === next.constructId)),
  );
  if (existing) {
    existing.functionName ??= next.functionName;
    existing.constructId ??= next.constructId;
    existing.handler ??= next.handler;
    existing.entry ??= next.entry;
    existing.line = Math.min(existing.line, next.line);
    return;
  }
  candidates.push({ ...next, score: 0, reasons: [] });
}

function extractCandidatesFromFile(file: string, content: string): LambdaCandidate[] {
  const candidates: LambdaCandidate[] = [];
  const lines = content.split(/\r?\n/);

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? "";
    const constructMatch = line.match(
      /new\s+(?:[A-Za-z_$][\w$.]*\.)?(?:Function|NodejsFunction|DockerImageFunction)\s*\([^,]+,\s*["'`]([^"'`]+)["'`]/,
    );
    if (!constructMatch?.[1]) continue;

    const block = lines.slice(index, Math.min(index + 14, lines.length)).join("\n");
    const functionName = block.match(/functionName\s*:\s*["'`]([^"'`]+)["'`]/)?.[1];
    const handler = block.match(/handler\s*:\s*["'`]([^"'`]+)["'`]/)?.[1];
    const entry = block.match(/entry\s*:\s*["'`]([^"'`]+)["'`]/)?.[1];
    pushCandidate(candidates, {
      file,
      line: index + 1,
      constructId: constructMatch[1],
      functionName,
      handler,
      entry,
    });
  }

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? "";
    const functionName = line.match(/functionName\s*:\s*["'`]([^"'`]+)["'`]/)?.[1];
    if (!functionName) continue;
    const block = lines.slice(Math.max(0, index - 4), Math.min(index + 10, lines.length)).join("\n");
    const constructId = block.match(
      /new\s+(?:[A-Za-z_$][\w$.]*\.)?(?:Function|NodejsFunction|DockerImageFunction)\s*\([^,]+,\s*["'`]([^"'`]+)["'`]/,
    )?.[1];
    const handler = block.match(/handler\s*:\s*["'`]([^"'`]+)["'`]/)?.[1];
    const entry = block.match(/entry\s*:\s*["'`]([^"'`]+)["'`]/)?.[1];
    pushCandidate(candidates, {
      file,
      line: index + 1,
      functionName,
      constructId,
      handler,
      entry,
    });
  }

  return candidates;
}

function tokenize(prompt: string): string[] {
  return Array.from(new Set(prompt.toLowerCase().match(/[a-z0-9_-]+/g) ?? [])).filter((token) => token.length > 2);
}

function addScore(candidate: LambdaCandidate, amount: number, reason: string): void {
  candidate.score += amount;
  candidate.reasons.push(reason);
}

function scoreCandidate(candidate: LambdaCandidate, prompt: string): LambdaCandidate {
  const scored: LambdaCandidate = { ...candidate, reasons: [], score: 0 };
  const promptLower = prompt.toLowerCase();
  const fileLower = candidate.file.toLowerCase();
  const tokens = tokenize(prompt);

  const exactNeedles = [candidate.functionName, candidate.constructId, candidate.handler, candidate.entry].filter(
    Boolean,
  ) as string[];
  for (const needle of exactNeedles) {
    if (promptLower.includes(needle.toLowerCase())) addScore(scored, 10, `prompt references ${needle}`);
  }

  for (const token of tokens) {
    if (candidate.functionName?.toLowerCase().includes(token)) addScore(scored, 5, `functionName matches ${token}`);
    if (candidate.constructId?.toLowerCase().includes(token)) addScore(scored, 4, `constructId matches ${token}`);
    if (candidate.handler?.toLowerCase().includes(token)) addScore(scored, 2, `handler matches ${token}`);
    if (candidate.entry?.toLowerCase().includes(token)) addScore(scored, 2, `entry matches ${token}`);
    if (fileLower.includes(token)) addScore(scored, 1, `file path matches ${token}`);
  }

  if (scored.functionName && !scored.constructId) addScore(scored, 1, "explicit functionName");
  return scored;
}

export async function resolveLambdaFromRepo(cwd: string, prompt: string): Promise<LambdaResolution | string> {
  const files = await walk(cwd);
  const rawCandidates: LambdaCandidate[] = [];

  for (const file of files) {
    const content = await fs.readFile(file, "utf-8");
    rawCandidates.push(...extractCandidatesFromFile(path.relative(cwd, file), content));
  }

  if (rawCandidates.length === 0) return "No CDK Lambda candidates were found in this repo.";

  const candidates = rawCandidates
    .map((candidate) => scoreCandidate(candidate, prompt))
    .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file) || a.line - b.line);

  if (candidates.length === 1) {
    return { selected: candidates[0], candidates, ambiguous: false };
  }

  const first = candidates[0];
  const second = candidates[1];
  if (!first) return "No Lambda candidates were found after scoring.";

  const hasStrongLead = first.score > 0 && first.score >= (second?.score ?? 0) + 2;
  return {
    selected: hasStrongLead ? first : undefined,
    candidates,
    ambiguous: !hasStrongLead,
  };
}

export function formatLambdaCandidate(candidate: LambdaCandidate): string {
  const label = candidate.functionName ?? candidate.constructId ?? candidate.handler ?? candidate.file;
  const extras = [
    candidate.constructId && candidate.functionName !== candidate.constructId
      ? `construct ${candidate.constructId}`
      : "",
    candidate.handler ? `handler ${candidate.handler}` : "",
  ]
    .filter(Boolean)
    .join(", ");
  return extras
    ? `${label} — ${extras} (${candidate.file}:${candidate.line})`
    : `${label} (${candidate.file}:${candidate.line})`;
}
