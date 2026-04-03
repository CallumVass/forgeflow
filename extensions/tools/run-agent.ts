import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import type { Message } from "@mariozechner/pi-ai";
import { withFileMutationQueue } from "@mariozechner/pi-coding-agent";
import { type AnyCtx, emptyStage, type PipelineDetails, type StageResult } from "./types";

type OnUpdate = (partial: AgentToolResult<PipelineDetails>) => void;

function getPiInvocation(args: string[]): { command: string; args: string[] } {
  const currentScript = process.argv[1];
  if (currentScript && fs.existsSync(currentScript)) {
    return { command: process.execPath, args: [currentScript, ...args] };
  }
  const execName = path.basename(process.execPath).toLowerCase();
  if (!/^(node|bun)(\.exe)?$/.test(execName)) {
    return { command: process.execPath, args };
  }
  return { command: "pi", args };
}

function resolveAgentPath(name: string): string {
  const agentsDir = path.resolve(__dirname, "..", "..", "agents");
  return path.join(agentsDir, `${name}.md`);
}

async function writePromptToTempFile(name: string, prompt: string): Promise<{ dir: string; filePath: string }> {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "forgeflow-"));
  const filePath = path.join(tmpDir, `prompt-${name}.md`);
  await withFileMutationQueue(filePath, async () => {
    await fs.promises.writeFile(filePath, prompt, { encoding: "utf-8", mode: 0o600 });
  });
  return { dir: tmpDir, filePath };
}

/**
 * Run a forgeflow agent as a sub-process with streaming updates.
 */
export async function runAgent(
  agentName: string,
  task: string,
  options: {
    cwd: string;
    tools?: string[];
    signal?: AbortSignal;
    stages: StageResult[];
    pipeline: string;
    onUpdate?: OnUpdate;
  },
): Promise<StageResult> {
  const agentPath = resolveAgentPath(agentName);
  const stage =
    options.stages.find((s) => s.name === agentName && s.status === "pending") ??
    options.stages.find((s) => s.name === agentName);

  if (!stage) {
    const s = emptyStage(agentName);
    s.status = "failed";
    s.output = "Stage not found in pipeline";
    return s;
  }

  stage.status = "running";
  emitUpdate(options);

  const tools = options.tools ?? ["read", "write", "edit", "bash", "grep", "find"];
  const args: string[] = ["--mode", "json", "-p", "--no-session", "--tools", tools.join(",")];

  let tmpDir: string | null = null;
  let tmpFile: string | null = null;

  try {
    // Read agent system prompt and write to temp file
    const systemPrompt = fs.readFileSync(agentPath, "utf-8");
    const tmp = await writePromptToTempFile(agentName, systemPrompt);
    tmpDir = tmp.dir;
    tmpFile = tmp.filePath;
    args.push("--append-system-prompt", tmpFile);
    args.push(`Task: ${task}`);

    const exitCode = await new Promise<number>((resolve) => {
      const invocation = getPiInvocation(args);
      const proc = spawn(invocation.command, invocation.args, {
        cwd: options.cwd,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let buffer = "";

      const processLine = (line: string) => {
        if (!line.trim()) return;
        let event: AnyCtx;
        try {
          event = JSON.parse(line);
        } catch {
          return;
        }

        if (event.type === "message_end" && event.message) {
          const msg = event.message as Message;
          stage.messages.push(msg);

          if (msg.role === "assistant") {
            stage.usage.turns++;
            const usage = (msg as AnyCtx).usage;
            if (usage) {
              stage.usage.input += usage.input || 0;
              stage.usage.output += usage.output || 0;
              stage.usage.cacheRead += usage.cacheRead || 0;
              stage.usage.cacheWrite += usage.cacheWrite || 0;
              stage.usage.cost += usage.cost?.total || 0;
            }
            if (!stage.model && (msg as AnyCtx).model) stage.model = (msg as AnyCtx).model;
          }
          emitUpdate(options);
        }

        if (event.type === "tool_result_end" && event.message) {
          stage.messages.push(event.message as Message);
          emitUpdate(options);
        }
      };

      proc.stdout.on("data", (data: Buffer) => {
        buffer += data.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) processLine(line);
      });

      proc.stderr.on("data", (data: Buffer) => {
        stage.stderr += data.toString();
      });

      proc.on("close", (code) => {
        if (buffer.trim()) processLine(buffer);
        resolve(code ?? 0);
      });

      proc.on("error", () => resolve(1));

      if (options.signal) {
        const kill = () => {
          proc.kill("SIGTERM");
          setTimeout(() => {
            if (!proc.killed) proc.kill("SIGKILL");
          }, 5000);
        };
        if (options.signal.aborted) kill();
        else options.signal.addEventListener("abort", kill, { once: true });
      }
    });

    stage.exitCode = exitCode;
    stage.status = exitCode === 0 ? "done" : "failed";

    // Extract final text output
    for (let i = stage.messages.length - 1; i >= 0; i--) {
      // biome-ignore lint/style/noNonNullAssertion: index within bounds
      const msg = stage.messages[i]!;
      if (msg.role === "assistant") {
        for (const part of msg.content) {
          if (typeof part === "object" && "type" in part && part.type === "text" && "text" in part) {
            stage.output = part.text as string;
            break;
          }
        }
        if (stage.output) break;
      }
    }

    emitUpdate(options);
    return stage;
  } finally {
    if (tmpFile)
      try {
        fs.unlinkSync(tmpFile);
      } catch {}
    if (tmpDir)
      try {
        fs.rmdirSync(tmpDir);
      } catch {}
  }
}

function emitUpdate(options: { stages: StageResult[]; pipeline: string; onUpdate?: OnUpdate }) {
  if (!options.onUpdate) return;

  const running = options.stages.find((s) => s.status === "running");
  const text = running
    ? `[${running.name}] running...`
    : options.stages.every((s) => s.status === "done")
      ? "Pipeline complete"
      : "Processing...";

  options.onUpdate({
    content: [{ type: "text", text }],
    details: { pipeline: options.pipeline, stages: options.stages },
  });
}
