import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { spawnAgent, fileExists, execCommand } from "./lib/spawn-agent";
import { sendChat, sendError } from "./lib/ui";

export function registerPrdPipeline(pi: ExtensionAPI) {
  pi.registerCommand("prd-qa", {
    description: "Refine PRD.md via critic → architect → integrator loop",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const maxIterations = parseInt(args) || 10;
      const autonomous = pi.getFlag("autonomous");
      const cwd = process.cwd();

      if (!(await fileExists("PRD.md", cwd))) {
        sendError(pi, "PRD.md not found in current directory.");
        return;
      }

      await execCommand("rm -f QUESTIONS.md", cwd);
      sendChat(pi, `**Starting PRD refinement** (max ${maxIterations} iterations)\n\n---`);

      for (let i = 1; i <= maxIterations; i++) {
        // Integrator (if QUESTIONS.md exists from previous iteration)
        if (i > 1 && (await fileExists("QUESTIONS.md", cwd))) {
          ctx.ui.setWorkingMessage(`[${i}/${maxIterations}] Running integrator...`);
          const intResult = await spawnAgent(
            "prd-integrator",
            "Incorporate answers from QUESTIONS.md into PRD.md, then delete QUESTIONS.md.",
            { cwd, ctx, label: "integrator" }
          );
          if (!intResult.success) {
            sendError(pi, `Integrator failed: ${intResult.output}`);
            return;
          }
          sendChat(pi, "Integrator done — answers incorporated into PRD.md");
        }

        // Critic
        ctx.ui.setWorkingMessage(`[${i}/${maxIterations}] Running critic...`);
        const criticResult = await spawnAgent(
          "prd-critic",
          "Review PRD.md for completeness. If complete, output exactly: <COMPLETE>\nIf not, create QUESTIONS.md with specific questions.",
          { cwd, tools: ["read", "write", "bash", "grep", "find"], ctx, label: "critic" }
        );

        if (!criticResult.success) {
          sendError(pi, `Critic failed: ${criticResult.output}`);
          return;
        }

        if (criticResult.output.includes("<COMPLETE>")) {
          ctx.ui.setWorkingMessage();
          sendChat(pi, "---\n\n**PRD refinement complete.** Ready for `/create-issues`.");
          return;
        }

        if (!(await fileExists("QUESTIONS.md", cwd))) {
          sendError(pi, "Critic did not create QUESTIONS.md and did not signal completion.");
          return;
        }

        const questions = await execCommand("cat QUESTIONS.md", cwd);
        sendChat(pi, `**Critic raised questions:**\n\n${questions.stdout}`);

        // Architect
        ctx.ui.setWorkingMessage(`[${i}/${maxIterations}] Running architect...`);
        const archResult = await spawnAgent(
          "prd-architect",
          "Read PRD.md and answer all questions in QUESTIONS.md. Write answers inline in QUESTIONS.md.",
          { cwd, tools: ["read", "write", "edit", "bash", "grep", "find"], ctx, label: "architect" }
        );

        if (!archResult.success) {
          sendError(pi, `Architect failed: ${archResult.output}`);
          return;
        }

        const answers = await execCommand("cat QUESTIONS.md", cwd);
        sendChat(pi, `**Architect answers:**\n\n${answers.stdout}`);

        // Approval gate (interactive)
        if (!autonomous) {
          ctx.ui.setWorkingMessage();
          const action = await ctx.ui.select(
            `Iteration ${i} complete`,
            ["Continue refining", "Edit PRD first", "Accept & finish"]
          );

          if (action === "Accept & finish") {
            if (await fileExists("QUESTIONS.md", cwd)) {
              ctx.ui.setWorkingMessage("Running final integration...");
              await spawnAgent(
                "prd-integrator",
                "Incorporate answers from QUESTIONS.md into PRD.md, then delete QUESTIONS.md.",
                { cwd, ctx, label: "integrator" }
              );
            }
            ctx.ui.setWorkingMessage();
            sendChat(pi, "---\n\n**PRD accepted.** Ready for `/create-issues`.");
            return;
          }

          if (action === "Edit PRD first") {
            const prdContent = await execCommand("cat PRD.md", cwd);
            const edited = await ctx.ui.editor("Edit PRD.md", prdContent.stdout);
            if (edited != null && edited !== prdContent.stdout) {
              await execCommand(`cat > PRD.md << 'FORGEFLOW_EOF'\n${edited}\nFORGEFLOW_EOF`, cwd);
              sendChat(pi, "PRD updated. Continuing refinement...");
            }
          }
        }
      }

      ctx.ui.setWorkingMessage();
      sendChat(pi, `**Warning:** PRD refinement did not complete after ${maxIterations} iterations.`);
    },
  });
}
