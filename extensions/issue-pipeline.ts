import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { spawnAgent, fileExists, execCommand } from "./lib/spawn-agent";
import { sendChat, sendError } from "./lib/ui";

export function registerIssuePipeline(pi: ExtensionAPI) {
  pi.registerCommand("create-issues", {
    description: "Decompose PRD.md into vertical-slice GitHub issues",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const cwd = process.cwd();

      if (!(await fileExists("PRD.md", cwd))) {
        sendError(pi, "PRD.md not found in current directory.");
        return;
      }

      const prd = await execCommand("cat PRD.md", cwd);
      if (prd.stdout.trim().length < 50) {
        sendError(pi, "PRD.md appears empty or too short. Run `/prd-qa` first.");
        return;
      }

      if (prd.stdout.includes("## Done") && !prd.stdout.includes("## Next")) {
        sendError(pi, "PRD.md has a Done section but no Next section — nothing to create issues for.");
        return;
      }

      sendChat(pi, "**Starting issue creation** — exploring codebase and decomposing PRD...\n\n---");
      ctx.ui.setWorkingMessage("Creating issues from PRD...");

      const result = await spawnAgent(
        "issue-creator",
        "Decompose PRD.md into vertical-slice GitHub issues. Read the issue-template skill for the standard format.",
        { cwd, tools: ["read", "write", "bash", "grep", "find"], ctx, label: "issue-creator" }
      );

      ctx.ui.setWorkingMessage();

      if (!result.success) {
        sendError(pi, `Issue creation failed: ${result.output}`);
        return;
      }

      const count = await execCommand(
        'gh issue list --label "auto-generated" --state open --json number --jq "length"',
        cwd
      );

      const issueCount = count.stdout.trim() || "?";
      sendChat(pi, `---\n\n**Done — ${issueCount} issues created** with label \`auto-generated\`.\n\nStart implementing with \`/implement <issue#>\`.`);
    },
  });
}
