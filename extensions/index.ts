import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerForgeflowTool } from "./tools/forgeflow-tool";

function parseImplFlags(args: string) {
  const skipPlan = args.includes("--skip-plan");
  const skipReview = args.includes("--skip-review");
  const rest = args
    .replace(/--skip-plan/g, "")
    .replace(/--skip-review/g, "")
    .trim();
  const flags = [skipPlan ? ", skipPlan: true" : "", skipReview ? ", skipReview: true" : ""].join("");
  return { rest, flags };
}

const extension: (pi: ExtensionAPI) => void = (pi) => {
  // Register the main tool (LLM-callable with streaming)
  registerForgeflowTool(pi);

  // Thin command wrappers — steer the LLM to call the forgeflow tool
  pi.registerCommand("prd-qa", {
    description: "Refine PRD.md via critic → architect → integrator loop",
    handler: async (args) => {
      const maxIter = parseInt(args, 10) || 10;
      pi.sendUserMessage(
        `Use the forgeflow tool with pipeline "prd-qa" and maxIterations ${maxIter} to refine the PRD.`,
      );
    },
  });

  pi.registerCommand("create-issues", {
    description: "Decompose PRD.md into vertical-slice GitHub issues",
    handler: async () => {
      pi.sendUserMessage(
        `Use the forgeflow tool with pipeline "create-issues" to decompose the PRD into GitHub issues.`,
      );
    },
  });

  pi.registerCommand("create-issue", {
    description: "Create a single GitHub issue from a feature idea",
    handler: async (args) => {
      if (!args.trim()) {
        pi.sendUserMessage('I need a feature idea. Usage: /create-issue "Add user authentication"');
        return;
      }
      pi.sendUserMessage(
        `Use the forgeflow tool with pipeline "create-issue" and issue "${args.trim()}" to create a GitHub issue.`,
      );
    },
  });

  pi.registerCommand("implement", {
    description: "Implement a single issue using TDD. Usage: /implement <issue#> [--skip-plan] [--skip-review]",
    handler: async (args) => {
      const { rest: issue, flags } = parseImplFlags(args);

      if (issue) {
        pi.sendUserMessage(
          `Use the forgeflow tool with pipeline "implement", issue "${issue}"${flags}. Implement using TDD.`,
        );
      } else {
        pi.sendUserMessage(
          `Use the forgeflow tool with pipeline "implement"${flags}. No issue number provided — the tool will detect it from the current branch. Do NOT ask for an issue number. Implement using TDD.`,
        );
      }
    },
  });

  pi.registerCommand("implement-all", {
    description:
      "Loop through all open auto-generated issues: implement, review, merge. Flags: --skip-plan, --skip-review",
    handler: async (args) => {
      const { flags } = parseImplFlags(args);

      pi.sendUserMessage(
        `Use the forgeflow tool with pipeline "implement-all"${flags}. This processes all open auto-generated issues in dependency order: for each issue, create branch, plan, implement via TDD, refactor, review, create PR, merge, then move to the next. Do NOT ask for confirmation — run autonomously.`,
      );
    },
  });

  pi.registerCommand("review", {
    description: "Run code review: deterministic checks → reviewer → judge",
    handler: async (args) => {
      const target = args.trim() || "";
      pi.sendUserMessage(
        `Use the forgeflow tool with pipeline "review"${target ? ` and target "${target}"` : ""} to review the code.`,
      );
    },
  });

  pi.registerCommand("architecture", {
    description: "Analyze codebase for architectural friction and create RFC issues",
    handler: async () => {
      pi.sendUserMessage(`Use the forgeflow tool with pipeline "architecture" to analyze the codebase architecture.`);
    },
  });
};

export default extension;
