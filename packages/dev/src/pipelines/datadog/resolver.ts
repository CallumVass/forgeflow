import * as fs from "node:fs/promises";
import * as path from "node:path";

export interface LambdaCandidate {
  file: string;
  line: number;
  variableName?: string;
  className?: string;
  functionName?: string;
  constructId?: string;
  handler?: string;
  entry?: string;
  runtime?: string;
  codePath?: string;
  score: number;
  reasons: string[];
}

interface LambdaResolution {
  selected?: LambdaCandidate;
  candidates: LambdaCandidate[];
  ambiguous: boolean;
}

const SCANNED_FILE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".cs",
  ".py",
  ".java",
  ".kt",
  ".json",
  ".yml",
  ".yaml",
]);
const IGNORE_DIRS = new Set(["node_modules", ".git", ".next", "dist", "build", ".forgeflow"]);
const LAMBDA_HINTS = [
  "functionname",
  "lambdaname",
  "handler",
  "functionhandler",
  "entry",
  "runtime",
  "fromfunctionname",
  "fromfunctionarn",
  "fromfunctionattributes",
  "code.fromasset",
  "code = code.fromasset",
  "memorysize",
  "timeout",
  "reservedconcurrentexecutions",
  "amazon.lambda",
  "aws::lambda::function",
  "aws_lambda_function",
];

function isScannableFile(filePath: string): boolean {
  return SCANNED_FILE_EXTENSIONS.has(path.extname(filePath));
}

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORE_DIRS.has(entry.name)) await walk(fullPath, out);
      continue;
    }
    if (entry.isFile() && isScannableFile(fullPath)) out.push(fullPath);
  }
  return out;
}

function normaliseSearchText(input: string): string {
  return input
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .toLowerCase()
    .trim();
}

function tokenize(input: string): string[] {
  return Array.from(
    new Set(
      normaliseSearchText(input)
        .split(/\s+/)
        .filter((token) => token.length > 1),
    ),
  );
}

function extractPromptPathHints(prompt: string): string[] {
  return Array.from(prompt.matchAll(/@([^\s]+)/g))
    .map((match) => match[1]?.replace(/^["'([{]+/, "").replace(/["')\]},;:!?]+$/, ""))
    .filter((value): value is string => Boolean(value && value.length > 0))
    .map((value) => value.replace(/\\/g, "/").replace(/^\.\//, ""));
}

function pushCandidate(candidates: LambdaCandidate[], next: Omit<LambdaCandidate, "score" | "reasons">): void {
  const existing = candidates.find(
    (candidate) =>
      candidate.file === next.file &&
      ((candidate.variableName && next.variableName && candidate.variableName === next.variableName) ||
        (candidate.functionName && next.functionName && candidate.functionName === next.functionName) ||
        (candidate.constructId && next.constructId && candidate.constructId === next.constructId) ||
        candidate.line === next.line),
  );
  if (existing) {
    existing.variableName ??= next.variableName;
    existing.className ??= next.className;
    existing.functionName ??= next.functionName;
    existing.constructId ??= next.constructId;
    existing.handler ??= next.handler;
    existing.entry ??= next.entry;
    existing.runtime ??= next.runtime;
    existing.codePath ??= next.codePath;
    existing.line = Math.min(existing.line, next.line);
    return;
  }
  candidates.push({ ...next, score: 0, reasons: [] });
}

function readBlock(lines: string[], startIndex: number, maxLines = 30): string {
  return lines.slice(startIndex, Math.min(startIndex + maxLines, lines.length)).join("\n");
}

function extractStringProperty(block: string, names: string[]): string | undefined {
  for (const name of names) {
    const match = block.match(new RegExp(`\\b${name}\\b\\s*[:=]\\s*["']([^"']+)["']`, "i"));
    if (match?.[1]) return match[1];
  }
  return undefined;
}

function extractBareProperty(block: string, names: string[]): string | undefined {
  for (const name of names) {
    const match = block.match(new RegExp(`\\b${name}\\b\\s*[:=]\\s*([^,\\n}]+)`, "i"));
    const value = match?.[1]?.trim();
    if (value) return value;
  }
  return undefined;
}

function extractFromAssetPath(block: string): string | undefined {
  return (
    block.match(/\.fromAsset\s*\(\s*["'`]([^"'`]+)["'`]/i)?.[1] ??
    block.match(/\.FromAsset\s*\(\s*["'`]([^"'`]+)["'`]/i)?.[1]
  );
}

function extractArnFunctionName(arn: string): string | undefined {
  return arn.match(/:function:([^:]+)(?::|$)/)?.[1];
}

function extractConstructorStart(startWindow: string): { variableName?: string; className?: string } | undefined {
  const patterns = [
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*new\s+([A-Za-z_$][\w$.]*)\s*\(/,
    /(?:var|[A-Za-z_][\w<>,?.[\]]*)\s+([A-Za-z_][\w]*)\s*=\s*new\s+([A-Za-z_$][\w$.]*)\s*\(/,
    /new\s+([A-Za-z_$][\w$.]*)\s*\(/,
  ];

  for (const pattern of patterns) {
    const match = startWindow.match(pattern);
    if (!match) continue;
    if (match.length >= 3) {
      return { variableName: match[1], className: match[2] };
    }
    if (match.length >= 2) {
      return { className: match[1] };
    }
  }
  return undefined;
}

function isLambdaLikeBlock(block: string, className?: string, variableName?: string): boolean {
  const haystack = `${className ?? ""} ${variableName ?? ""} ${block}`.toLowerCase();
  return (
    LAMBDA_HINTS.some((hint) => haystack.includes(hint)) || /\b(lambda|function)\b/.test(normaliseSearchText(haystack))
  );
}

function extractCandidateDetails(
  file: string,
  line: number,
  block: string,
  start?: { variableName?: string; className?: string },
): Omit<LambdaCandidate, "score" | "reasons"> {
  const functionName = extractStringProperty(block, ["functionName", "lambdaName"]);
  const constructId = block.match(/\(\s*[^,]+,\s*["'`]([^"'`]+)["'`]/)?.[1];
  const handler = extractStringProperty(block, ["handler", "functionHandler"]);
  const entry = extractStringProperty(block, ["entry", "project", "projectPath", "assetPath"]);
  const runtime =
    extractStringProperty(block, ["runtime"]) ?? extractBareProperty(block, ["runtime"])?.replace(/[),]$/, "").trim();
  const codePath = extractFromAssetPath(block);

  return {
    file,
    line,
    variableName: start?.variableName,
    className: start?.className,
    functionName,
    constructId,
    handler,
    entry: entry ?? codePath,
    runtime,
    codePath,
  };
}

function extractCandidatesFromConstructStarts(file: string, lines: string[]): LambdaCandidate[] {
  const candidates: LambdaCandidate[] = [];

  for (let index = 0; index < lines.length; index++) {
    const startWindow = lines.slice(index, Math.min(index + 5, lines.length)).join(" ");
    const start = extractConstructorStart(startWindow);
    if (!start) continue;

    const block = readBlock(lines, index);
    if (!isLambdaLikeBlock(block, start.className, start.variableName)) continue;
    pushCandidate(candidates, extractCandidateDetails(file, index + 1, block, start));
  }

  return candidates;
}

function extractCandidatesFromFactoryMethods(file: string, lines: string[]): LambdaCandidate[] {
  const candidates: LambdaCandidate[] = [];

  for (let index = 0; index < lines.length; index++) {
    const startWindow = lines.slice(index, Math.min(index + 5, lines.length)).join(" ");
    const variableName =
      startWindow.match(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*/)?.[1] ??
      startWindow.match(/(?:var|[A-Za-z_][\w<>,?.[\]]*)\s+([A-Za-z_][\w]*)\s*=\s*/)?.[1];

    const fromFunctionName = startWindow.match(/[A-Za-z_$][\w$.]*\.fromFunctionName\s*\(/);
    if (fromFunctionName) {
      const block = readBlock(lines, index, 16);
      const match = block.match(/\(\s*[^,]+,\s*["'`]([^"'`]+)["'`]\s*,\s*["'`]([^"'`]+)["'`]/);
      if (variableName || match?.[1] || match?.[2]) {
        pushCandidate(candidates, {
          file,
          line: index + 1,
          variableName,
          className: fromFunctionName[0].split(".")[0],
          constructId: match?.[1],
          functionName: match?.[2],
          handler: undefined,
          entry: undefined,
          runtime: undefined,
          codePath: undefined,
        });
      }
      continue;
    }

    const fromFunctionArn = startWindow.match(/[A-Za-z_$][\w$.]*\.fromFunctionArn\s*\(/);
    if (fromFunctionArn) {
      const block = readBlock(lines, index, 16);
      const match = block.match(/\(\s*[^,]+,\s*["'`]([^"'`]+)["'`]\s*,\s*["'`]([^"'`]+)["'`]/);
      const functionArn = match?.[2];
      if (variableName || match?.[1] || functionArn) {
        pushCandidate(candidates, {
          file,
          line: index + 1,
          variableName,
          className: fromFunctionArn[0].split(".")[0],
          constructId: match?.[1],
          functionName: functionArn ? extractArnFunctionName(functionArn) : undefined,
          handler: undefined,
          entry: undefined,
          runtime: undefined,
          codePath: undefined,
        });
      }
      continue;
    }

    const fromFunctionAttributes = startWindow.match(/[A-Za-z_$][\w$.]*\.fromFunctionAttributes\s*\(/);
    if (fromFunctionAttributes) {
      const block = readBlock(lines, index, 24);
      const constructId = block.match(/\(\s*[^,]+,\s*["'`]([^"'`]+)["'`]/)?.[1];
      const functionName = extractStringProperty(block, ["functionName", "lambdaName"]);
      const functionArn = extractStringProperty(block, ["functionArn"]);
      if (variableName || constructId || functionName || functionArn) {
        pushCandidate(candidates, {
          file,
          line: index + 1,
          variableName,
          className: fromFunctionAttributes[0].split(".")[0],
          constructId,
          functionName: functionName ?? (functionArn ? extractArnFunctionName(functionArn) : undefined),
          handler: undefined,
          entry: undefined,
          runtime: undefined,
          codePath: undefined,
        });
      }
    }
  }

  return candidates;
}

function extractCandidatesFromPropertyBlocks(file: string, lines: string[]): LambdaCandidate[] {
  const candidates: LambdaCandidate[] = [];

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? "";
    if (!/\b(functionName|lambdaName|functionHandler|handler)\b/i.test(line)) continue;

    const block = lines.slice(Math.max(0, index - 6), Math.min(index + 8, lines.length)).join("\n");
    if (!isLambdaLikeBlock(block)) continue;

    const constructBlock = lines.slice(Math.max(0, index - 8), Math.min(index + 10, lines.length)).join(" ");
    const start = extractConstructorStart(constructBlock);
    pushCandidate(candidates, extractCandidateDetails(file, index + 1, block, start));
  }

  return candidates;
}

function extractCandidatesFromFile(file: string, content: string): LambdaCandidate[] {
  const lines = content.split(/\r?\n/);
  const combined: LambdaCandidate[] = [];
  for (const candidate of [
    ...extractCandidatesFromConstructStarts(file, lines),
    ...extractCandidatesFromFactoryMethods(file, lines),
    ...extractCandidatesFromPropertyBlocks(file, lines),
  ]) {
    pushCandidate(combined, candidate);
  }
  return combined;
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
  const promptPathHints = extractPromptPathHints(prompt).map((hint) => hint.toLowerCase());

  const exactNeedles = [
    candidate.variableName,
    candidate.className,
    candidate.functionName,
    candidate.constructId,
    candidate.handler,
    candidate.entry,
    candidate.codePath,
  ].filter(Boolean) as string[];
  for (const needle of exactNeedles) {
    if (promptLower.includes(needle.toLowerCase())) addScore(scored, 10, `prompt references ${needle}`);
  }

  for (const hint of promptPathHints) {
    if (fileLower === hint || fileLower.endsWith(`/${hint}`) || hint.endsWith(fileLower)) {
      addScore(scored, 12, `prompt references ${candidate.file}`);
    }
  }

  for (const token of tokens) {
    if (candidate.variableName?.toLowerCase().includes(token)) addScore(scored, 6, `variableName matches ${token}`);
    if (candidate.className?.toLowerCase().includes(token)) addScore(scored, 3, `className matches ${token}`);
    if (candidate.functionName?.toLowerCase().includes(token)) addScore(scored, 5, `functionName matches ${token}`);
    if (candidate.constructId?.toLowerCase().includes(token)) addScore(scored, 4, `constructId matches ${token}`);
    if (candidate.handler?.toLowerCase().includes(token)) addScore(scored, 2, `handler matches ${token}`);
    if (candidate.entry?.toLowerCase().includes(token)) addScore(scored, 2, `entry matches ${token}`);
    if (candidate.codePath?.toLowerCase().includes(token)) addScore(scored, 2, `codePath matches ${token}`);
    if (fileLower.includes(token)) addScore(scored, 1, `file path matches ${token}`);
  }

  if (/infra|cdk|stack/.test(fileLower)) addScore(scored, 1, "infra-like file path");
  if (scored.functionName) addScore(scored, 2, "explicit functionName");
  else if (scored.constructId) addScore(scored, 1, "explicit constructId");
  else if (scored.variableName) addScore(scored, 1, "explicit variableName");
  return scored;
}

export async function resolveLambdaFromRepo(cwd: string, prompt: string): Promise<LambdaResolution | string> {
  const files = await walk(cwd);
  const rawCandidates: LambdaCandidate[] = [];

  for (const file of files) {
    const content = await fs.readFile(file, "utf-8");
    rawCandidates.push(...extractCandidatesFromFile(path.relative(cwd, file), content));
  }

  if (rawCandidates.length === 0) {
    return `No Lambda candidates were found after scanning ${files.length} repo files.`;
  }

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
  const label =
    candidate.functionName ??
    candidate.constructId ??
    candidate.variableName ??
    candidate.entry ??
    candidate.handler ??
    candidate.file;
  const extras = [
    candidate.className ? `class ${candidate.className}` : "",
    candidate.variableName && candidate.variableName !== label ? `variable ${candidate.variableName}` : "",
    candidate.constructId && candidate.constructId !== label ? `construct ${candidate.constructId}` : "",
    candidate.handler ? `handler ${candidate.handler}` : "",
    candidate.entry && candidate.entry !== label ? `entry ${candidate.entry}` : "",
  ]
    .filter(Boolean)
    .join(", ");
  return extras
    ? `${label} — ${extras} (${candidate.file}:${candidate.line})`
    : `${label} (${candidate.file}:${candidate.line})`;
}
