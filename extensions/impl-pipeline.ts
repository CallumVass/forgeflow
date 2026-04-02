import { spawnAgent, fileExists, execCommand } from "./lib/spawn-agent";

export function registerImplPipeline(pi: any) {
  pi.registerCommand("implement", {
    description: "Plan → implement → refactor an issue using TDD",
    handler: async (args: string, ctx: any) => {
      const autonomous = pi.getFlag("autonomous");
      const cwd = process.cwd();

      if (!args.trim()) {
        ctx.ui.notify(
          "Usage: /implement <issue-number> or /implement <description>",
          "error"
        );
        return;
      }

      // Determine if it's an issue number or inline description
      const issueMatch = args.trim().match(/^#?(\d+)$/);
      let issueTitle = "";
      let issueBody = "";

      if (issueMatch) {
        const issueNum = issueMatch[1];
        ctx.ui.notify(`Fetching issue #${issueNum}...`, "info");
        const issue = await execCommand(
          `gh issue view ${issueNum} --json title,body --jq '"## " + .title + "\\n\\n" + .body'`,
          cwd
        );
        if (issue.code !== 0) {
          ctx.ui.notify(`Failed to fetch issue #${issueNum}: ${issue.stderr}`, "error");
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

      // Step 1: Plan
      ctx.ui.notify("Running planner...", "info");
      const planResult = await spawnAgent(
        "planner",
        `Plan the implementation for this issue by producing a sequenced list of test cases.\n\nISSUE: ${issueTitle}\n\n${issueBody}`,
        { cwd, tools: ["read", "bash", "grep", "find"] }
      );

      if (!planResult.success) {
        ctx.ui.notify(`Planner failed: ${planResult.output}`, "error");
        return;
      }

      const plan = planResult.output;

      // Step 2: Approval gate (interactive only)
      if (!autonomous) {
        // Check for unresolved questions
        if (plan.includes("### Unresolved Questions") && !plan.includes("(none)")) {
          const editedPlan = await ctx.ui.editor("Review plan (has unresolved questions)", plan);
          if (editedPlan === null) {
            ctx.ui.notify("Implementation cancelled.", "info");
            return;
          }
        } else {
          const action = await ctx.ui.select("Plan ready. Proceed?", [
            "Approve & implement",
            "Edit plan first",
            "Cancel",
          ]);

          if (action === "Cancel") {
            ctx.ui.notify("Implementation cancelled.", "info");
            return;
          }

          if (action === "Edit plan first") {
            const editedPlan = await ctx.ui.editor("Edit test plan", plan);
            if (editedPlan === null) {
              ctx.ui.notify("Implementation cancelled.", "info");
              return;
            }
            // Use editedPlan below — for now we pass through
          }
        }

        // Create feature branch
        let branchName: string;
        if (issueMatch) {
          const slug = issueTitle
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "")
            .slice(0, 50);
          branchName = `feat/${issueMatch[1]}-${slug}`;
        } else {
          const slug = issueTitle
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "")
            .slice(0, 50);
          branchName = `feat/${slug}`;
        }

        ctx.ui.notify(`Creating branch: ${branchName}`, "info");
        await execCommand(`git checkout -b ${branchName}`, cwd);
      }

      // Step 3: Implement
      ctx.ui.notify("Running implementor...", "info");

      const implPrompt = autonomous
        ? `Implement the following issue using strict TDD (red-green-refactor).\n\nISSUE: ${issueTitle}\n\n${issueBody}\n\nIMPLEMENTATION PLAN (follow this test sequence):\n${plan}\n\nWORKFLOW:\n1. Read the codebase to understand current state.\n2. Implement using TDD following the plan above.\n3. After all behaviors pass, refactor.\n4. Run the project's check command. Fix any failures.\n5. Commit changes.\n\nCONSTRAINTS:\n- Do NOT create or switch branches.\n- Do NOT modify or delete existing tests unless required.\n- If you encounter a blocker, stop and output: <HALT>`
        : `Implement the following issue using strict TDD (red-green-refactor).\n\nISSUE: ${issueTitle}\n\n${issueBody}\n\nIMPLEMENTATION PLAN (follow this test sequence):\n${plan}\n\nWORKFLOW:\n1. Read the codebase to understand current state.\n2. Implement using TDD following the plan above.\n3. After all behaviors pass, refactor.\n4. Run the project's check command. Fix any failures.\n5. Commit changes with a concise message referencing the issue.\n6. Push the branch and create a PR.\n\nCONSTRAINTS:\n- Do NOT create or switch branches. The orchestrator already checked out the correct branch.\n- Do NOT modify or delete existing tests unless this issue requires it.\n- If you encounter a blocker, stop and output: <HALT>`;

      const implResult = await spawnAgent("implementor", implPrompt, {
        cwd,
        tools: ["read", "write", "edit", "bash", "grep", "find"],
      });

      if (implResult.output.includes("<HALT>")) {
        ctx.ui.notify(`Implementor blocked: ${implResult.output}`, "error");
        pi.sendMessage(`Implementation blocked:\n${implResult.output}`, {
          triggerTurn: false,
        });
        return;
      }

      if (!implResult.success) {
        ctx.ui.notify(`Implementor failed: ${implResult.output}`, "error");
        return;
      }

      // Step 4: Refactor
      ctx.ui.notify("Running refactorer...", "info");
      const refactorResult = await spawnAgent(
        "refactorer",
        `Review the code added in this branch (use git diff main...HEAD) and compare with the rest of the codebase.\n\nRULES:\n- Only refactor if there's a clear win (2+ duplicated blocks, or a pattern used 3+ times).\n- Run the project's check command after any refactoring.\n- Commit and push changes if you made any.\n- If no refactoring is needed, just say so.`,
        { cwd, tools: ["read", "write", "edit", "bash", "grep", "find"] }
      );

      // Step 5: Report
      ctx.ui.notify("Implementation complete.", "info");

      if (!autonomous) {
        const action = await ctx.ui.select("Implementation done. What next?", [
          "Run /review",
          "Done",
        ]);

        if (action === "Run /review") {
          // Trigger review pipeline
          const commands = pi.getCommands();
          const reviewCmd = commands.find((c: any) => c.name === "review");
          if (reviewCmd) {
            await reviewCmd.handler("--branch", ctx);
          }
        }
      }

      pi.sendMessage(
        `Implementation complete for: ${issueTitle}\n\nRefactorer: ${refactorResult.output.slice(0, 200)}`,
        { triggerTurn: false }
      );
    },
  });
}
