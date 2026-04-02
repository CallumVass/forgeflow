import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerForgeflowTool } from "./tools/forgeflow-tool";

const extension: (pi: ExtensionAPI) => void = (pi) => {
  // Register the main tool (LLM-callable with streaming)
  registerForgeflowTool(pi);

  // Thin command wrappers — steer the LLM to call the forgeflow tool
  pi.registerCommand("prd-qa", {
    description: "Refine PRD.md via critic → architect → integrator loop",
    handler: async (args) => {
      const maxIter = parseInt(args) || 10;
      pi.sendUserMessage(
        `Use the forgeflow tool with pipeline "prd-qa" and maxIterations ${maxIter} to refine the PRD.`
      );
    },
  });

  pi.registerCommand("create-issues", {
    description: "Decompose PRD.md into vertical-slice GitHub issues",
    handler: async () => {
      pi.sendUserMessage(
        `Use the forgeflow tool with pipeline "create-issues" to decompose the PRD into GitHub issues.`
      );
    },
  });

  pi.registerCommand("implement", {
    description: "Plan → implement → refactor an issue using TDD",
    handler: async (args) => {
      if (!args.trim()) {
        pi.sendUserMessage("I need an issue number or description to implement. Usage: /implement <issue#>");
        return;
      }
      pi.sendUserMessage(
        `Use the forgeflow tool with pipeline "implement" and issue "${args.trim()}" to implement it using TDD.`
      );
    },
  });

  pi.registerCommand("review", {
    description: "Run code review: deterministic checks → reviewer → judge",
    handler: async (args) => {
      const target = args.trim() || "";
      pi.sendUserMessage(
        `Use the forgeflow tool with pipeline "review"${target ? ` and target "${target}"` : ""} to review the code.`
      );
    },
  });
};

export default extension;
