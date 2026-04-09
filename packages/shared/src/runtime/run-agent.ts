import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { SessionManager, withFileMutationQueue } from "@mariozechner/pi-coding-agent";
import { loadAgent } from "../agents/loader.js";
import { applyMessageToStage, extractFinalOutput, parseMessageLine } from "./message-parser.js";
import { emitUpdate } from "./progress.js";
import { emptyStage, type RunAgentOpts, type StageResult } from "./stages.js";

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

/**
 * Materialise a forked session at a caller-chosen path.
 *
 * Pi's CLI rejects `--fork` together with `--session`, but forgeflow needs
 * both semantics: inherit an earlier phase's history *and* keep deterministic
 * per-stage session files under `.forgeflow/run/<runId>/`. To bridge that, we
 * fork via the SDK into the target directory, then rename the generated file to
 * the requested `sessionPath` and invoke pi with `--session <sessionPath>`.
 */
function materialiseForkedSession(sessionPath: string, forkFrom: string, cwd: string): void {
  const dir = path.dirname(sessionPath);
  fs.mkdirSync(dir, { recursive: true });

  const forked = SessionManager.forkFrom(forkFrom, cwd, dir);
  const forkedPath = forked.getSessionFile();
  if (!forkedPath) {
    throw new Error(`Failed to materialise forked session from ${forkFrom}`);
  }

  // Replace the pre-created empty target file from the run-dir allocator.
  try {
    fs.rmSync(sessionPath, { force: true });
  } catch {}
  fs.renameSync(forkedPath, sessionPath);
  fs.chmodSync(sessionPath, 0o600);
}

/** Run a forgeflow agent as a sub-process with streaming updates. */
export async function runAgent(agentName: string, task: string, options: RunAgentOpts): Promise<StageResult> {
  // Single source of truth: the agent's own .md frontmatter. Pipelines never
  // supply a tool list — it is read here from disk via `loadAgent`.
  const agent = await loadAgent(options.agentsDir, agentName);
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

  const args: string[] = ["--mode", "json", "-p", "--tools", agent.tools.join(",")];

  // Session wiring. Four cases in order of precedence:
  //   1. sessionPath + forkFrom   → materialise fork into <target>, then
  //      invoke pi with --session <target>
  //   2. sessionPath only         → --session <target>
  //      (auto-allocated by `withRunLifecycle` for cold-start phases)
  //   3. forkFrom only            → --fork <source>
  //      (caller wants inherited context but not a deterministic file path)
  //   4. neither                  → --no-session
  //      (persistence disabled, or caller explicitly opted out)
  if (options.sessionPath && options.forkFrom) {
    materialiseForkedSession(options.sessionPath, options.forkFrom, options.cwd);
    args.push("--session", options.sessionPath);
  } else if (options.sessionPath) {
    args.push("--session", options.sessionPath);
  } else if (options.forkFrom) {
    args.push("--fork", options.forkFrom);
  } else {
    args.push("--no-session");
  }

  // Per-agent overrides are keyed by the raw agent file stem (not `stageName`),
  // so a pipeline that spawns the same agent under a disambiguating stage name
  // (e.g. `fix-findings` → `implementor`) still picks up the override.
  const override = options.agentOverrides?.[agentName];
  if (override?.model) args.push("--model", override.model);
  if (override?.thinkingLevel) args.push("--thinking", override.thinkingLevel);

  let tmpDir: string | null = null;
  let tmpFile: string | null = null;

  try {
    const tmp = await writePromptToTempFile(agentName, agent.systemPrompt);
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
