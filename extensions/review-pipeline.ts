import { spawnAgent, execCommand } from "./lib/spawn-agent";

export function registerReviewPipeline(pi: any) {
  pi.registerCommand("review", {
    description: "Run code review: deterministic checks → reviewer → judge",
    handler: async (args: string, ctx: any) => {
      const autonomous = pi.getFlag("autonomous");
      const cwd = process.cwd();

      // Determine diff source
      let diff = "";
      let prNumber = "";
      const trimmedArgs = args.trim();

      if (trimmedArgs.match(/^\d+$/)) {
        // PR number
        prNumber = trimmedArgs;
        const result = await execCommand(`gh pr diff ${prNumber}`, cwd);
        if (result.code !== 0) {
          ctx.ui.notify(`Failed to get PR diff: ${result.stderr}`, "error");
          return;
        }
        diff = result.stdout;
      } else if (trimmedArgs.startsWith("--branch")) {
        // Branch diff
        const branch = trimmedArgs.replace("--branch", "").trim() || "HEAD";
        const result = await execCommand(`git diff main...${branch}`, cwd);
        diff = result.stdout;
      } else {
        // Default: current branch vs main
        const result = await execCommand("git diff main...HEAD", cwd);
        diff = result.stdout;
      }

      if (!diff.trim()) {
        ctx.ui.notify("No changes to review.", "info");
        return;
      }

      // Step 1: Deterministic checks
      const skipChecks = trimmedArgs.includes("--skip-checks");

      if (!skipChecks) {
        ctx.ui.notify("Running deterministic checks...", "info");

        // Auto-detect check command
        const checkCmd = await detectCheckCommand(cwd);

        if (checkCmd) {
          const checkResult = await execCommand(checkCmd, cwd);
          if (checkResult.code !== 0) {
            ctx.ui.notify(
              `Deterministic checks failed:\n${checkResult.stdout}\n${checkResult.stderr}`,
              "error"
            );
            pi.sendMessage(
              `Review halted — deterministic checks failed.\n\`\`\`\n${(checkResult.stdout + "\n" + checkResult.stderr).slice(0, 1000)}\n\`\`\``,
              { triggerTurn: false }
            );
            return;
          }
          ctx.ui.notify("Deterministic checks passed.", "info");
        } else {
          ctx.ui.notify(
            "Deterministic checks skipped — no check command detected.",
            "info"
          );
        }
      }

      // Step 2: Detect domain plugins
      const plugins = await detectPlugins(diff, cwd);
      if (plugins.length > 0) {
        ctx.ui.notify(`Detected domain plugins: ${plugins.join(", ")}`, "info");
      }

      // Step 3: Spawn code-reviewer
      ctx.ui.notify("Running code reviewer...", "info");

      let reviewPrompt = `Review the following diff:\n\n${diff}`;
      if (plugins.length > 0) {
        reviewPrompt += `\n\nDomain plugins detected: ${plugins.join(", ")}\nFor each plugin, read the corresponding PLUGIN.md from the review-plugins skill and apply its additional checks.`;
      }

      const reviewResult = await spawnAgent("code-reviewer", reviewPrompt, {
        cwd,
        tools: ["read", "bash", "grep", "find"],
      });

      if (!reviewResult.success) {
        ctx.ui.notify(`Code reviewer failed: ${reviewResult.output}`, "error");
        return;
      }

      // Step 4: Check if review passed
      if (
        reviewResult.output.includes("<PASS>") ||
        reviewResult.output.toLowerCase().includes("no issues found")
      ) {
        ctx.ui.notify("Review passed — no actionable findings.", "info");
        pi.sendMessage("<PASS>\nReview passed — no actionable findings.", {
          triggerTurn: false,
        });

        // Propose approval (interactive + PR)
        if (!autonomous && prNumber) {
          await proposeApproval(pi, ctx, prNumber, cwd);
        }
        return;
      }

      // Step 5: Spawn review-judge
      ctx.ui.notify("Running review judge...", "info");
      const judgeResult = await spawnAgent(
        "review-judge",
        `Validate the following code review findings against the actual code:\n\n${reviewResult.output}`,
        { cwd, tools: ["read", "bash", "grep", "find"] }
      );

      if (!judgeResult.success) {
        ctx.ui.notify(`Review judge failed: ${judgeResult.output}`, "error");
        return;
      }

      // Step 6: Report
      if (judgeResult.output.includes("<PASS>")) {
        ctx.ui.notify(
          "Review passed — judge filtered all findings.",
          "info"
        );
        pi.sendMessage("<PASS>\nReview passed — all findings were filtered by judge.", {
          triggerTurn: false,
        });

        if (!autonomous && prNumber) {
          await proposeApproval(pi, ctx, prNumber, cwd);
        }
      } else {
        ctx.ui.notify("Review found issues.", "warning");
        pi.sendMessage(`Review findings:\n\n${judgeResult.output}`, {
          triggerTurn: false,
        });

        // Propose PR comments (interactive + PR)
        if (!autonomous && prNumber) {
          await proposeComments(pi, ctx, prNumber, judgeResult.output, cwd);
        }
      }
    },
  });
}

/**
 * Auto-detect the project's check command.
 */
async function detectCheckCommand(cwd: string): Promise<string | null> {
  // Check CHECK_CMD env var first
  if (process.env.CHECK_CMD) return process.env.CHECK_CMD;

  // Auto-detect by project files
  const checks: [string, string][] = [
    ["mix.exs", "mix format --check-formatted && mix credo && mix test"],
    ["Cargo.toml", "cargo clippy -- -D warnings && cargo test"],
    ["go.mod", "go vet ./... && go test ./..."],
    [
      "pyproject.toml",
      "ruff check . && pytest",
    ],
  ];

  for (const [file, cmd] of checks) {
    const result = await execCommand(`test -f ${file}`, cwd);
    if (result.code === 0) return cmd;
  }

  // package.json with check script
  const pkgResult = await execCommand(
    'test -f package.json && node -e "const p=require(\'./package.json\'); process.exit(p.scripts?.check ? 0 : 1)"',
    cwd
  );
  if (pkgResult.code === 0) {
    // Detect package manager
    const pnpm = await execCommand("test -f pnpm-lock.yaml", cwd);
    return pnpm.code === 0 ? "pnpm check" : "npm run check";
  }

  return null;
}

/**
 * Detect which review plugins match the diff.
 */
async function detectPlugins(diff: string, cwd: string): Promise<string[]> {
  // Get changed files from diff
  const fileMatches = diff.match(/^diff --git a\/(.*?) b\//gm) || [];
  const changedFiles = fileMatches.map((m) =>
    m.replace("diff --git a/", "").replace(/ b\/.*/, "")
  );

  // Simple plugin detection — check tailwind triggers
  const tailwindFileMatch = changedFiles.some(
    (f) => f.endsWith(".tsx") || f.endsWith(".jsx") || f.endsWith(".css")
  );
  const tailwindContentMatch = [
    "className=",
    "cn(",
    "cva(",
    "@apply",
    "@theme",
    "tailwind",
    "tailwind-merge",
    "clsx",
  ].some((s) => diff.includes(s));

  const plugins: string[] = [];
  if (tailwindFileMatch && tailwindContentMatch) {
    plugins.push("tailwind");
  }

  return plugins;
}

/**
 * Propose PR approval in interactive mode.
 */
async function proposeApproval(
  pi: any,
  ctx: any,
  prNumber: string,
  cwd: string
) {
  const action = await ctx.ui.select("Approve this PR?", ["Yes", "No"]);
  if (action === "Yes") {
    const repoResult = await execCommand(
      "gh repo view --json nameWithOwner --jq .nameWithOwner",
      cwd
    );
    const repo = repoResult.stdout.trim();
    await execCommand(
      `gh pr review ${prNumber} --approve --body "Looks good!" --repo ${repo}`,
      cwd
    );
    ctx.ui.notify("PR approved.", "info");
  }
}

/**
 * Propose PR comments for findings in interactive mode.
 */
async function proposeComments(
  pi: any,
  ctx: any,
  prNumber: string,
  findings: string,
  cwd: string
) {
  const action = await ctx.ui.select("Post findings as PR comments?", [
    "Yes",
    "No",
  ]);
  if (action === "Yes") {
    // Post as a single review comment for simplicity
    const repoResult = await execCommand(
      "gh repo view --json nameWithOwner --jq .nameWithOwner",
      cwd
    );
    const repo = repoResult.stdout.trim();
    const body = findings.slice(0, 4000); // GH comment limit
    await execCommand(
      `gh pr review ${prNumber} --request-changes --body "${body.replace(/"/g, '\\"')}" --repo ${repo}`,
      cwd
    );
    ctx.ui.notify("Review comments posted.", "info");
  }
}
