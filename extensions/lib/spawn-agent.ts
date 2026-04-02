import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export interface SpawnAgentOptions {
  tools?: string[];
  model?: string;
  cwd?: string;
  onUpdate?: (text: string) => void;
}

export interface AgentResult {
  output: string;
  success: boolean;
}

/**
 * Resolve an agent definition file bundled with forgeflow.
 * Looks in the agents/ directory relative to this extension.
 */
function resolveAgentPath(name: string): string {
  // Navigate from extensions/lib/ up to package root, then into agents/
  const agentsDir = resolve(__dirname, "..", "..", "agents");
  return join(agentsDir, `${name}.md`);
}

/**
 * Find the pi binary. Uses the same binary that's running the parent process,
 * falling back to "pi" on PATH.
 */
function findPiBinary(): { command: string; args: string[] } {
  // If running inside pi, process.argv[0] is node and process.argv[1] is the pi script
  // Safest: just use "pi" from PATH since it's globally installed
  return { command: "pi", args: [] };
}

/**
 * Parse JSON events from pi's --mode json stdout.
 * Each line is a JSON event. We accumulate assistant text from message_end events.
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

      // message_end contains the full message
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

      // Also capture streaming text deltas for progress
      if (event.type === "message_update" && event.content) {
        // Streaming partial — don't accumulate, just notify
        if (typeof event.content === "string") {
          onUpdate?.(event.content);
        }
      }
    } catch {
      // Not valid JSON — might be partial line, ignore
    }
  }
}

/**
 * Spawn a Pi sub-agent process and collect its output.
 *
 * The agent runs in JSON mode (--mode json) with no session persistence (--no-session).
 * Its system prompt comes from the agent definition file (--append-system-prompt).
 */
export async function spawnAgent(
  name: string,
  task: string,
  options: SpawnAgentOptions = {}
): Promise<AgentResult> {
  const agentPath = resolveAgentPath(name);

  // Verify agent file exists
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
  } = options;

  const pi = findPiBinary();

  const args = [
    ...pi.args,
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
    const proc = spawn(pi.command, args, {
      cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });

    const accumulated: string[] = [];
    let stderr = "";

    proc.stdout.on("data", (chunk: Buffer) => {
      parseJsonEvents(chunk.toString(), accumulated, onUpdate);
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("close", (code) => {
      const output =
        accumulated.join("\n").trim() || stderr.trim() || "(no output)";
      resolvePromise({
        output,
        success: code === 0,
      });
    });

    proc.on("error", (err) => {
      resolvePromise({
        output: `Failed to spawn agent "${name}": ${err.message}`,
        success: false,
      });
    });
  });
}

/**
 * Check if a file exists in the current working directory.
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
