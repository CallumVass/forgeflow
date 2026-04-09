import * as fs from "node:fs";
import * as path from "node:path";

// ─── Signals ──────────────────────────────────────────────────────────

export const SIGNALS = {
  questions: "QUESTIONS.md",
  findings: "FINDINGS.md",
  blocked: "BLOCKED.md",
} as const;

type Signal = keyof typeof SIGNALS;

export function signalPath(cwd: string, signal: Signal): string {
  return path.join(cwd, SIGNALS[signal]);
}

export function signalExists(cwd: string, signal: Signal): boolean {
  return fs.existsSync(signalPath(cwd, signal));
}

export function readSignal(cwd: string, signal: Signal): string | null {
  const p = signalPath(cwd, signal);
  try {
    return fs.readFileSync(p, "utf-8");
  } catch {
    return null;
  }
}

export function cleanSignal(cwd: string, signal: Signal): void {
  try {
    fs.unlinkSync(signalPath(cwd, signal));
  } catch {}
}
