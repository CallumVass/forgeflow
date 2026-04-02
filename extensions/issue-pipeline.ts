import { spawnAgent, fileExists, execCommand } from "./lib/spawn-agent";

export function registerIssuePipeline(pi: any) {
  pi.registerCommand("create-issues", {
    description: "Decompose PRD.md into vertical-slice GitHub issues",
    handler: async (args: string, ctx: any) => {
      const cwd = process.cwd();

      // Verify PRD exists
      if (!(await fileExists("PRD.md", cwd))) {
        ctx.ui.notify("PRD.md not found in current directory.", "error");
        return;
      }

      // Validate PRD has content
      const prd = await execCommand("cat PRD.md", cwd);
      if (prd.stdout.trim().length < 50) {
        ctx.ui.notify(
          "PRD.md appears empty or too short. Run /prd-qa first.",
          "error"
        );
        return;
      }

      // Check for phase-aware PRD with nothing to implement
      if (prd.stdout.includes("## Done") && !prd.stdout.includes("## Next")) {
        ctx.ui.notify(
          "PRD.md has a Done section but no Next section — nothing to create issues for.",
          "error"
        );
        return;
      }

      ctx.ui.notify("Spawning issue creator...", "info");

      const result = await spawnAgent(
        "issue-creator",
        "Decompose PRD.md into vertical-slice GitHub issues. Read the issue-template skill for the standard format.",
        { cwd, tools: ["read", "write", "bash", "grep", "find"] }
      );

      if (!result.success) {
        ctx.ui.notify(`Issue creation failed: ${result.output}`, "error");
        return;
      }

      // Count created issues
      const count = await execCommand(
        'gh issue list --label "auto-generated" --state open --json number --jq "length"',
        cwd
      );

      const issueCount = count.stdout.trim() || "?";
      ctx.ui.notify(`Done — ${issueCount} issues created.`, "info");
      pi.sendMessage(
        `Issue creation complete. ${issueCount} issues created with label \`auto-generated\`.`,
        { triggerTurn: false }
      );
    },
  });
}
