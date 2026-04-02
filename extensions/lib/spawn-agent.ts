import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";

export interface SpawnAgentOptions {
  tools?: string[];
  model?: string;
  cwd?: string;
  onUpdate?: (text: string) => void;
  /** Extension command context — used for working message updates */
  ctx?: ExtensionCommandContext;
  /** Label shown during progress (e.g., "prd-critic") */
  label?: string;
}

export interface AgentResult {
  output: string;
  success: boolean;
}

/**
 * Resolve an agent definition file bundled with forgeflow.
 */
function resolveAgentPath(name: string): string {
  const agentsDir = resolve(__dirname, "..", "..", "agents");
  return join(agentsDir, `${name}.md`);
}

/**
 * Parse JSON events from pi's --mode json stdout.
 */
function parseJsonEvents(
  data: string,
  accumulated: string[],
  onUpdate?: (text: string) => void
): void {
  const lines = data.split("\n").filter((l) => l.trim());
  for (const line of lines) {
    try {
      const event = JSON.parse(line);

      if (event.type === "message_end" && event.message) {
        const msg = event.message;
        if (msg.role === "assistant" && Array.isArray(msg.content)) {
          for (const block of msg.content) {
            if (block.type === "text" && block.text) {
              accumulated.push(block.text);
              onUpdate?.(block.text);
            }
          }
        }
      }

      if (event.type === "message_update" && event.content) {
        if (typeof event.content === "string") {
          onUpdate?.(event.content);
        }
      }
    } catch {
      // partial line, ignore
    }
  }
}

/**
 * Spawn a Pi sub-agent process and collect its output.
 */
export async function spawnAgent(
  name: string,
  task: string,
  options: SpawnAgentOptions = {}
): Promise<AgentResult> {
  const agentPath = resolveAgentPath(name);

  try {
    readFileSync(agentPath, "utf-8");
  } catch {
    return {
      output: `Agent definition not found: ${name} (looked at ${agentPath})`,
      success: false,
    };
  }

  const {
    tools = ["read", "write", "edit", "bash", "grep", "find"],
    model,
    cwd = process.cwd(),
    onUpdate,
    ctx,
    label,
  } = options;

  const updateHandler =
    onUpdate ??
    (ctx && label
      ? (text: string) => {
          if (text.length > 10) {
            const preview = text.slice(0, 80).replace(/\n/g, " ");
            ctx.ui.setWorkingMessage(`[${label}] ${preview}...`);
          }
        }
      : undefined);

  const args = [
    "--mode",
    "json",
    "-p",
    "--no-session",
    "--tools",
    tools.join(","),
    "--append-system-prompt",
    agentPath,
    task,
  ];

  if (model) {
    args.push("--model", model);
  }

  return new Promise<AgentResult>((resolvePromise) => {
    const proc = spawn("pi", args, {
      cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });

    const accumulated: string[] = [];
    let stderr = "";

    proc.stdout.on("data", (chunk: Buffer) => {
      parseJsonEvents(chunk.toString(), accumulated, updateHandler);
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("close", (code) => {
      ctx?.ui.setWorkingMessage();
      const output =
        accumulated.join("\n").trim() || stderr.trim() || "(no output)";
      resolvePromise({
        output,
        success: code === 0,
      });
    });

    proc.on("error", (err) => {
      ctx?.ui.setWorkingMessage();
      resolvePromise({
        output: `Failed to spawn agent "${name}": ${err.message}`,
        success: false,
      });
    });
  });
}

/**
 * Check if a file exists.
 */
export async function fileExists(
  filePath: string,
  cwd?: string
): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn("test", ["-f", filePath], {
      cwd: cwd || process.cwd(),
      shell: true,
      stdio: "ignore",
    });
    proc.on("close", (code) => resolve(code === 0));
    proc.on("error", () => resolve(false));
  });
}

/**
 * Run a shell command and return its output.
 */
export async function execCommand(
  command: string,
  cwd?: string
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const proc = spawn("bash", ["-c", command], {
      cwd: cwd || process.cwd(),
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("close", (code) => {
      resolve({ stdout: stdout.trim(), stderr: stderr.trim(), code: code ?? 1 });
    });
    proc.on("error", (err) => {
      resolve({ stdout: "", stderr: err.message, code: 1 });
    });
  });
}
