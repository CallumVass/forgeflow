import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { withFileMutationQueue } from "@mariozechner/pi-coding-agent";
import { applyMessageToStage, extractFinalOutput, parseMessageLine } from "./message-parser.js";
import { emitUpdate } from "./progress.js";
import { emptyStage, type RunAgentOpts, type StageResult } from "./types.js";

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

async function writePromptToTempFile(name: string, prompt: string): Promise<{ dir: string; filePath: string }> {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "forgeflow-"));
  const filePath = path.join(tmpDir, `prompt-${name}.md`);
  await withFileMutationQueue(filePath, async () => {
    await fs.promises.writeFile(filePath, prompt, { encoding: "utf-8", mode: 0o600 });
  });
  return { dir: tmpDir, filePath };
}

/** Run a forgeflow agent as a sub-process with streaming updates. */
export async function runAgent(agentName: string, task: string, options: RunAgentOpts): Promise<StageResult> {
  const agentPath = path.join(options.agentsDir, `${agentName}.md`);
  const lookupName = options.stageName ?? agentName;
  const stage =
    options.stages.find((s) => s.name === lookupName && s.status === "pending") ??
    options.stages.find((s) => s.name === lookupName);

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
        const event = parseMessageLine(line);
        if (!event) return;
        if (applyMessageToStage(event, stage)) {
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

    extractFinalOutput(stage);

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
