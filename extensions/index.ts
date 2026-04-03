import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerForgeflowTool } from "./tools/forgeflow-tool";

function parseImplFlags(args: string) {
  const skipPlan = args.includes("--skip-plan");
  const skipReview = args.includes("--skip-review");
  const rest = args
    .replace(/--skip-plan/g, "")
    .replace(/--skip-review/g, "")
    .trim();

  // First token = issue, rest = custom prompt (strip surrounding quotes if present)
  const firstSpace = rest.indexOf(" ");
  const issue = firstSpace === -1 ? rest : rest.slice(0, firstSpace);
  const customPrompt =
    firstSpace === -1
      ? ""
      : rest
          .slice(firstSpace + 1)
          .trim()
          .replace(/^"(.*)"$/, "$1");

  const flags = [skipPlan ? ", skipPlan: true" : "", skipReview ? ", skipReview: true" : ""].join("");
  return { issue, customPrompt, flags };
}

function parseReviewArgs(args: string) {
  const trimmed = args.trim();
  if (!trimmed) return { target: "", customPrompt: "" };

  // Handle --branch <name> as a two-token target
  if (trimmed.startsWith("--branch")) {
    const afterFlag = trimmed.replace(/^--branch\s*/, "").trim();
    const firstSpace = afterFlag.indexOf(" ");
    if (firstSpace === -1) return { target: `--branch ${afterFlag}`, customPrompt: "" };
    return {
      target: `--branch ${afterFlag.slice(0, firstSpace)}`,
      customPrompt: afterFlag
        .slice(firstSpace + 1)
        .trim()
        .replace(/^"(.*)"$/, "$1"),
    };
  }

  const firstSpace = trimmed.indexOf(" ");
  if (firstSpace === -1) return { target: trimmed, customPrompt: "" };
  return {
    target: trimmed.slice(0, firstSpace),
    customPrompt: trimmed
      .slice(firstSpace + 1)
      .trim()
      .replace(/^"(.*)"$/, "$1"),
  };
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
    description:
      "Implement a single issue using TDD. Usage: /implement <issue#|JIRA-KEY> [custom prompt] [--skip-plan] [--skip-review]",
    handler: async (args) => {
      const { issue, customPrompt, flags } = parseImplFlags(args);
      const promptPart = customPrompt ? `, customPrompt: "${customPrompt}"` : "";

      if (issue) {
        pi.sendUserMessage(
          `Use the forgeflow tool with pipeline "implement", issue "${issue}"${promptPart}${flags}. Implement using TDD.`,
        );
      } else {
        pi.sendUserMessage(
          `Use the forgeflow tool with pipeline "implement"${promptPart}${flags}. No issue number provided — the tool will detect it from the current branch. Do NOT ask for an issue number. Implement using TDD.`,
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
    description: "Run code review: deterministic checks → reviewer → judge. Usage: /review [target] [custom prompt]",
    handler: async (args) => {
      const { target, customPrompt } = parseReviewArgs(args);
      const promptPart = customPrompt ? `, customPrompt: "${customPrompt}"` : "";
      pi.sendUserMessage(
        `Use the forgeflow tool with pipeline "review"${target ? ` and target "${target}"` : ""}${promptPart} to review the code.`,
      );
    },
  });

  pi.registerCommand("architecture", {
    description: "Analyze codebase for architectural friction and create RFC issues",
    handler: async () => {
      pi.sendUserMessage(`Use the forgeflow tool with pipeline "architecture" to analyze the codebase architecture.`);
    },
  });

  pi.registerCommand("discover-skills", {
    description: "Find and install domain-specific plugins from skills.sh for this project's tech stack",
    handler: async (args) => {
      const query = args.trim();
      if (query) {
        pi.sendUserMessage(
          `Use the forgeflow tool with pipeline "discover-skills" and issue "${query}" to find and install relevant skills.`,
        );
      } else {
        pi.sendUserMessage(
          `Use the forgeflow tool with pipeline "discover-skills" to analyze the project and find relevant skills to install.`,
        );
      }
    },
  });
};

export default extension;
