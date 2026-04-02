import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { spawnAgent, execCommand } from "./lib/spawn-agent";
import { sendChat, sendError } from "./lib/ui";

export function registerReviewPipeline(pi: ExtensionAPI) {
  pi.registerCommand("review", {
    description: "Run code review: deterministic checks → reviewer → judge",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const autonomous = pi.getFlag("autonomous");
      const cwd = process.cwd();

      let diff = "";
      let prNumber = "";
      const trimmedArgs = args.trim();

      if (trimmedArgs.match(/^\d+$/)) {
        prNumber = trimmedArgs;
        ctx.ui.setWorkingMessage(`Fetching PR #${prNumber} diff...`);
        const result = await execCommand(`gh pr diff ${prNumber}`, cwd);
        if (result.code !== 0) {
          sendError(pi, `Failed to get PR diff: ${result.stderr}`);
          return;
        }
        diff = result.stdout;
      } else if (trimmedArgs.startsWith("--branch")) {
        const branch = trimmedArgs.replace("--branch", "").trim() || "HEAD";
        const result = await execCommand(`git diff main...${branch}`, cwd);
        diff = result.stdout;
      } else {
        const result = await execCommand("git diff main...HEAD", cwd);
        diff = result.stdout;
      }

      if (!diff.trim()) {
        sendChat(pi, "No changes to review.");
        return;
      }

      sendChat(pi, `**Starting code review** (${diff.split("\n").length} lines of diff)\n\n---`);

      // Deterministic checks
      if (!trimmedArgs.includes("--skip-checks")) {
        ctx.ui.setWorkingMessage("Running deterministic checks...");
        const checkCmd = await detectCheckCommand(cwd);

        if (checkCmd) {
          const checkResult = await execCommand(checkCmd, cwd);
          if (checkResult.code !== 0) {
            ctx.ui.setWorkingMessage();
            sendError(pi, `Deterministic checks failed — review halted.\n\n\`\`\`\n${(checkResult.stdout + "\n" + checkResult.stderr).slice(0, 1500)}\n\`\`\``);
            return;
          }
          sendChat(pi, "Deterministic checks passed.");
        } else {
          sendChat(pi, "_Deterministic checks skipped — no check command detected._");
        }
      }

      // Detect plugins
      const plugins = await detectPlugins(diff);
      if (plugins.length > 0) {
        sendChat(pi, `Detected domain plugins: **${plugins.join(", ")}**`);
      }

      // Code reviewer
      sendChat(pi, "### Code Reviewer\nAnalyzing diff...");
      ctx.ui.setWorkingMessage("Running code reviewer...");

      let reviewPrompt = `Review the following diff:\n\n${diff}`;
      if (plugins.length > 0) {
        reviewPrompt += `\n\nDomain plugins detected: ${plugins.join(", ")}\nFor each plugin, read the corresponding PLUGIN.md from the review-plugins skill and apply its additional checks.`;
      }

      const reviewResult = await spawnAgent("code-reviewer", reviewPrompt, {
        cwd, tools: ["read", "bash", "grep", "find"], ctx, label: "code-reviewer",
      });

      if (!reviewResult.success) {
        sendError(pi, `Code reviewer failed: ${reviewResult.output}`);
        return;
      }

      if (reviewResult.output.includes("<PASS>") || reviewResult.output.toLowerCase().includes("no issues found")) {
        ctx.ui.setWorkingMessage();
        sendChat(pi, "---\n\n**Review passed** — no actionable findings.");
        if (!autonomous && prNumber) await proposeApproval(pi, ctx, prNumber, cwd);
        return;
      }

      // Review judge
      sendChat(pi, "### Review Judge\nValidating findings...");
      ctx.ui.setWorkingMessage("Running review judge...");
      const judgeResult = await spawnAgent(
        "review-judge",
        `Validate the following code review findings against the actual code:\n\n${reviewResult.output}`,
        { cwd, tools: ["read", "bash", "grep", "find"], ctx, label: "review-judge" }
      );

      ctx.ui.setWorkingMessage();

      if (!judgeResult.success) {
        sendError(pi, `Review judge failed: ${judgeResult.output}`);
        return;
      }

      if (judgeResult.output.includes("<PASS>")) {
        sendChat(pi, "---\n\n**Review passed** — judge filtered all findings.");
        if (!autonomous && prNumber) await proposeApproval(pi, ctx, prNumber, cwd);
      } else {
        sendChat(pi, `---\n\n**Review findings:**\n\n${judgeResult.output}`);
        if (!autonomous && prNumber) await proposeComments(pi, ctx, prNumber, judgeResult.output, cwd);
      }
    },
  });
}

async function detectCheckCommand(cwd: string): Promise<string | null> {
  if (process.env.CHECK_CMD) return process.env.CHECK_CMD;
  const checks: [string, string][] = [
    ["mix.exs", "mix format --check-formatted && mix credo && mix test"],
    ["Cargo.toml", "cargo clippy -- -D warnings && cargo test"],
    ["go.mod", "go vet ./... && go test ./..."],
    ["pyproject.toml", "ruff check . && pytest"],
  ];
  for (const [file, cmd] of checks) {
    if ((await execCommand(`test -f ${file}`, cwd)).code === 0) return cmd;
  }
  const pkgResult = await execCommand(
    'test -f package.json && node -e "const p=require(\'./package.json\'); process.exit(p.scripts?.check ? 0 : 1)"',
    cwd
  );
  if (pkgResult.code === 0) {
    return (await execCommand("test -f pnpm-lock.yaml", cwd)).code === 0 ? "pnpm check" : "npm run check";
  }
  return null;
}

async function detectPlugins(diff: string): Promise<string[]> {
  const fileMatches = diff.match(/^diff --git a\/(.*?) b\//gm) || [];
  const changedFiles = fileMatches.map((m) => m.replace("diff --git a/", "").replace(/ b\/.*/, ""));
  const tailwindFiles = changedFiles.some((f) => f.endsWith(".tsx") || f.endsWith(".jsx") || f.endsWith(".css"));
  const tailwindContent = ["className=", "cn(", "cva(", "@apply", "@theme", "tailwind", "tailwind-merge", "clsx"].some((s) => diff.includes(s));
  return tailwindFiles && tailwindContent ? ["tailwind"] : [];
}

async function proposeApproval(pi: ExtensionAPI, ctx: ExtensionCommandContext, prNumber: string, cwd: string) {
  const action = await ctx.ui.select("Approve this PR?", ["Yes", "No"]);
  if (action === "Yes") {
    const repo = (await execCommand("gh repo view --json nameWithOwner --jq .nameWithOwner", cwd)).stdout.trim();
    await execCommand(`gh pr review ${prNumber} --approve --body "Looks good!" --repo ${repo}`, cwd);
    sendChat(pi, "PR approved.");
  }
}

async function proposeComments(pi: ExtensionAPI, ctx: ExtensionCommandContext, prNumber: string, findings: string, cwd: string) {
  const action = await ctx.ui.select("Post findings as PR review?", ["Yes", "No"]);
  if (action === "Yes") {
    const repo = (await execCommand("gh repo view --json nameWithOwner --jq .nameWithOwner", cwd)).stdout.trim();
    const body = findings.slice(0, 4000).replace(/"/g, '\\"');
    await execCommand(`gh pr review ${prNumber} --request-changes --body "${body}" --repo ${repo}`, cwd);
    sendChat(pi, "Review comments posted.");
  }
}
