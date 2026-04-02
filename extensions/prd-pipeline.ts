import { spawnAgent, fileExists, execCommand } from "./lib/spawn-agent";

export function registerPrdPipeline(pi: any) {
  pi.registerCommand("prd-qa", {
    description: "Refine PRD.md via critic → architect → integrator loop",
    handler: async (args: string, ctx: any) => {
      const maxIterations = parseInt(args) || 10;
      const autonomous = pi.getFlag("autonomous");
      const cwd = process.cwd();

      // Verify PRD exists
      if (!(await fileExists("PRD.md", cwd))) {
        ctx.ui.notify("PRD.md not found in current directory.", "error");
        return;
      }

      // Clean up stale QUESTIONS.md
      await execCommand("rm -f QUESTIONS.md", cwd);

      ctx.ui.notify(`Starting PRD refinement (max ${maxIterations} iterations)`, "info");

      for (let i = 1; i <= maxIterations; i++) {
        // Step 1: Run integrator if QUESTIONS.md exists from previous iteration
        if (i > 1 && (await fileExists("QUESTIONS.md", cwd))) {
          ctx.ui.notify(`[${i}/${maxIterations}] Running integrator...`, "info");
          const intResult = await spawnAgent(
            "prd-integrator",
            "Incorporate answers from QUESTIONS.md into PRD.md, then delete QUESTIONS.md.",
            { cwd }
          );
          if (!intResult.success) {
            ctx.ui.notify(`Integrator failed: ${intResult.output}`, "error");
            return;
          }
        }

        // Step 2: Run critic
        ctx.ui.notify(`[${i}/${maxIterations}] Running critic...`, "info");
        const criticResult = await spawnAgent(
          "prd-critic",
          "Review PRD.md for completeness. If complete, output exactly: <COMPLETE>\nIf not, create QUESTIONS.md with specific questions.",
          { cwd, tools: ["read", "write", "bash", "grep", "find"] }
        );

        if (!criticResult.success) {
          ctx.ui.notify(`Critic failed: ${criticResult.output}`, "error");
          return;
        }

        // Check for completion
        if (criticResult.output.includes("<COMPLETE>")) {
          ctx.ui.notify("PRD refinement complete!", "info");
          pi.sendMessage("PRD.md has been refined and is ready for implementation.", {
            triggerTurn: false,
          });
          return;
        }

        // Verify critic created QUESTIONS.md
        if (!(await fileExists("QUESTIONS.md", cwd))) {
          ctx.ui.notify(
            "Critic did not create QUESTIONS.md and did not signal completion. Stopping.",
            "error"
          );
          return;
        }

        // Step 3: Run architect
        ctx.ui.notify(`[${i}/${maxIterations}] Running architect...`, "info");
        const archResult = await spawnAgent(
          "prd-architect",
          "Read PRD.md and answer all questions in QUESTIONS.md. Write answers inline in QUESTIONS.md.",
          { cwd, tools: ["read", "write", "edit", "bash", "grep", "find"] }
        );

        if (!archResult.success) {
          ctx.ui.notify(`Architect failed: ${archResult.output}`, "error");
          return;
        }

        // Approval gate (interactive mode only)
        if (!autonomous) {
          const action = await ctx.ui.select(
            `Iteration ${i} complete — critic found issues, architect answered.`,
            ["Continue refining", "Edit PRD first", "Accept & finish"]
          );

          if (action === "Accept & finish") {
            // Run integrator one final time if QUESTIONS.md exists
            if (await fileExists("QUESTIONS.md", cwd)) {
              ctx.ui.notify("Running final integration...", "info");
              await spawnAgent(
                "prd-integrator",
                "Incorporate answers from QUESTIONS.md into PRD.md, then delete QUESTIONS.md.",
                { cwd }
              );
            }
            ctx.ui.notify("PRD accepted.", "info");
            pi.sendMessage("PRD.md refinement complete (accepted by user).", {
              triggerTurn: false,
            });
            return;
          }

          if (action === "Edit PRD first") {
            // Let user edit, then continue loop
            const prdContent = await execCommand("cat PRD.md", cwd);
            const edited = await ctx.ui.editor("Edit PRD.md", prdContent.stdout);
            if (edited !== null && edited !== prdContent.stdout) {
              await execCommand(`cat > PRD.md << 'FORGEFLOW_EOF'\n${edited}\nFORGEFLOW_EOF`, cwd);
            }
          }
          // "Continue refining" falls through to next iteration
        }
      }

      ctx.ui.notify(
        `PRD refinement did not complete after ${maxIterations} iterations. Review PRD.md and QUESTIONS.md manually.`,
        "warning"
      );
    },
  });
}
