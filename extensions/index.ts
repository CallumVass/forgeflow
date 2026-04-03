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
  pi.registerCommand("continue", {
    description:
      'Update PRD with Done/Next based on codebase state, QA the Next section, then create issues. Usage: /continue ["description of next phase"]',
    handler: async (args) => {
      const trimmed = args.trim().replace(/^"(.*)"$/, "$1");
      const descPart = trimmed ? `, issue="${trimmed}"` : "";
      pi.sendUserMessage(
        `Call the forgeflow tool now with these exact parameters: pipeline="continue"${descPart}. Do not interpret the description — pass it as-is.`,
      );
    },
  });

  pi.registerCommand("prd-qa", {
    description: "Refine PRD.md via critic → architect → integrator loop",
    handler: async (args) => {
      const maxIter = parseInt(args, 10) || 10;
      pi.sendUserMessage(
        `Call the forgeflow tool now with these exact parameters: pipeline="prd-qa", maxIterations=${maxIter}.`,
      );
    },
  });

  pi.registerCommand("create-issues", {
    description: "Decompose PRD.md into vertical-slice GitHub issues",
    handler: async () => {
      pi.sendUserMessage(`Call the forgeflow tool now with these exact parameters: pipeline="create-issues".`);
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
        `Call the forgeflow tool now with these exact parameters: pipeline="create-issue", issue="${args.trim()}". Do not interpret the issue text — pass it as-is.`,
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
          `Call the forgeflow tool now with these exact parameters: pipeline="implement", issue="${issue}"${promptPart}${flags}. Do not interpret the issue number — pass it as-is.`,
        );
      } else {
        pi.sendUserMessage(
          `Call the forgeflow tool now with these exact parameters: pipeline="implement"${promptPart}${flags}. No issue number provided — the tool will detect it from the current branch. Do NOT ask for an issue number.`,
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
        `Call the forgeflow tool now with these exact parameters: pipeline="implement-all"${flags}. Do NOT ask for confirmation — run autonomously.`,
      );
    },
  });

  pi.registerCommand("review", {
    description: "Run code review: deterministic checks → reviewer → judge. Usage: /review [target] [custom prompt]",
    handler: async (args) => {
      const { target, customPrompt } = parseReviewArgs(args);
      const promptPart = customPrompt ? `, customPrompt: "${customPrompt}"` : "";
      pi.sendUserMessage(
        `Call the forgeflow tool now with these exact parameters: pipeline="review"${target ? `, target="${target}"` : ""}${promptPart}. Do not interpret the target — pass it as-is.`,
      );
    },
  });

  pi.registerCommand("architecture", {
    description: "Analyze codebase for architectural friction and create RFC issues",
    handler: async () => {
      pi.sendUserMessage(`Call the forgeflow tool now with these exact parameters: pipeline="architecture".`);
    },
  });

  pi.registerCommand("discover-skills", {
    description: "Find and install domain-specific plugins from skills.sh for this project's tech stack",
    handler: async (args) => {
      const query = args.trim();
      if (query) {
        pi.sendUserMessage(
          `Call the forgeflow tool now with these exact parameters: pipeline="discover-skills", issue="${query}". Present the tool's output verbatim — do not summarize or reformat it.`,
        );
      } else {
        pi.sendUserMessage(
          `Call the forgeflow tool now with these exact parameters: pipeline="discover-skills". Present the tool's output verbatim — do not summarize or reformat it.`,
        );
      }
    },
  });
};

export default extension;
