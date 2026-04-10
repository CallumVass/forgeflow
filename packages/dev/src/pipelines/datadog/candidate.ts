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
