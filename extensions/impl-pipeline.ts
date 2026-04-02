import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { spawnAgent, execCommand } from "./lib/spawn-agent";
import { sendChat, sendError } from "./lib/ui";

export function registerImplPipeline(pi: ExtensionAPI) {
  pi.registerCommand("implement", {
    description: "Plan → implement → refactor an issue using TDD",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const autonomous = pi.getFlag("autonomous");
      const cwd = process.cwd();

      if (!args.trim()) {
        sendError(pi, "Usage: `/implement <issue-number>` or `/implement <description>`");
        return;
      }

      const issueMatch = args.trim().match(/^#?(\d+)$/);
      let issueTitle = "";
      let issueBody = "";

      if (issueMatch) {
        const issueNum = issueMatch[1];
        ctx.ui.setWorkingMessage(`Fetching issue #${issueNum}...`);
        const issue = await execCommand(
          `gh issue view ${issueNum} --json title,body --jq '"## " + .title + "\\n\\n" + .body'`,
          cwd
        );
        if (issue.code !== 0) {
          sendError(pi, `Failed to fetch issue #${issueNum}: ${issue.stderr}`);
          return;
        }
        issueTitle = (await execCommand(
          `gh issue view ${issueNum} --json title --jq '.title'`,
          cwd
        )).stdout.trim();
        issueBody = issue.stdout;
      } else {
        issueTitle = args.trim().split("\n")[0];
        issueBody = args.trim();
      }

      sendChat(pi, `**Implementing:** ${issueTitle}\n\n---`);

      // Plan
      sendChat(pi, "### Planner\nProducing test sequence...");
      ctx.ui.setWorkingMessage("Running planner...");
      const planResult = await spawnAgent(
        "planner",
        `Plan the implementation for this issue by producing a sequenced list of test cases.\n\nISSUE: ${issueTitle}\n\n${issueBody}`,
        { cwd, tools: ["read", "bash", "grep", "find"], ctx, label: "planner" }
      );

      if (!planResult.success) {
        sendError(pi, `Planner failed: ${planResult.output}`);
        return;
      }

      const plan = planResult.output;
      sendChat(pi, `**Test plan:**\n\n${plan}`);
      ctx.ui.setWorkingMessage();

      // Approval gate (interactive)
      if (!autonomous) {
        const action = await ctx.ui.select("Plan ready. Proceed?", [
          "Approve & implement",
          "Edit plan first",
          "Cancel",
        ]);

        if (action === "Cancel" || action == null) {
          sendChat(pi, "Implementation cancelled.");
          return;
        }

        if (action === "Edit plan first") {
          const editedPlan = await ctx.ui.editor("Edit test plan", plan);
          if (editedPlan == null) {
            sendChat(pi, "Implementation cancelled.");
            return;
          }
        }

        // Create feature branch
        const slug = issueTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50);
        const branchName = issueMatch ? `feat/${issueMatch[1]}-${slug}` : `feat/${slug}`;

        sendChat(pi, `Creating branch: \`${branchName}\``);
        await execCommand(`git checkout -b ${branchName}`, cwd);
      }

      // Implement
      sendChat(pi, "### Implementor\nStarting TDD red-green-refactor...");
      ctx.ui.setWorkingMessage("Running implementor...");

      const constraints = autonomous
        ? "CONSTRAINTS:\n- Do NOT create or switch branches.\n- Do NOT modify or delete existing tests unless required.\n- If you encounter a blocker, stop and output: <HALT>"
        : "CONSTRAINTS:\n- Do NOT create or switch branches. The orchestrator already checked out the correct branch.\n- Do NOT modify or delete existing tests unless this issue requires it.\n- If you encounter a blocker, stop and output: <HALT>";

      const implResult = await spawnAgent(
        "implementor",
        `Implement the following issue using strict TDD (red-green-refactor).\n\nISSUE: ${issueTitle}\n\n${issueBody}\n\nIMPLEMENTATION PLAN (follow this test sequence):\n${plan}\n\nWORKFLOW:\n1. Read the codebase to understand current state.\n2. Implement using TDD following the plan above.\n3. After all behaviors pass, refactor.\n4. Run the project's check command. Fix any failures.\n5. Commit changes with a concise message referencing the issue.\n6. Push the branch and create a PR.\n\n${constraints}`,
        { cwd, tools: ["read", "write", "edit", "bash", "grep", "find"], ctx, label: "implementor" }
      );

      if (implResult.output.includes("<HALT>")) {
        ctx.ui.setWorkingMessage();
        sendError(pi, `Implementor blocked:\n${implResult.output}`);
        return;
      }

      if (!implResult.success) {
        sendError(pi, `Implementor failed: ${implResult.output}`);
        return;
      }

      // Refactor
      sendChat(pi, "### Refactorer\nChecking for duplication...");
      ctx.ui.setWorkingMessage("Running refactorer...");
      const refactorResult = await spawnAgent(
        "refactorer",
        "Review the code added in this branch (use git diff main...HEAD) and compare with the rest of the codebase.\n\nRULES:\n- Only refactor if there's a clear win.\n- Run the project's check command after any refactoring.\n- Commit and push changes if you made any.\n- If no refactoring is needed, just say so.",
        { cwd, tools: ["read", "write", "edit", "bash", "grep", "find"], ctx, label: "refactorer" }
      );

      ctx.ui.setWorkingMessage();
      sendChat(pi, `**Refactorer:** ${refactorResult.output.slice(0, 500)}`);
      sendChat(pi, `---\n\n**Implementation complete** for: ${issueTitle}`);

      if (!autonomous) {
        const action = await ctx.ui.select("What next?", ["Run /review", "Done"]);
        if (action === "Run /review") {
          const commands = pi.getCommands();
          const reviewCmd = commands.find((c) => c.name === "review");
          if (reviewCmd?.source === "extension") {
            // Trigger review via the handler
            await (reviewCmd as any).handler?.("--branch", ctx);
          }
        }
      }
    },
  });
}
