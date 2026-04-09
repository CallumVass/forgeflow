import { type PipelineContext, pipelineResult, withRunLifecycle } from "@callumvass/forgeflow-shared/pipeline";
import { promptBootstrapPrd } from "../prd/bootstrap.js";
import { prdExists } from "../prd/document.js";

export async function runInit(pctx: PipelineContext) {
  return withRunLifecycle(pctx, "init", (innerPctx) => runInitInner(innerPctx));
}

async function runInitInner(pctx: PipelineContext) {
  if (prdExists(pctx.cwd)) {
    return pipelineResult("PRD.md already exists. Run /prd-qa to refine it.", "init", []);
  }

  if (!pctx.ctx.hasUI) {
    return pipelineResult(
      "PRD.md not found. /init requires interactive mode, or you can create PRD.md manually and then run /prd-qa.",
      "init",
      [],
    );
  }

  const created = await promptBootstrapPrd(pctx, {
    confirmationTitle: "Create an initial PRD draft now?",
  });

  if (!created) {
    return pipelineResult("PRD initialisation cancelled.", "init", []);
  }

  return pipelineResult("Initial PRD draft created. Next: run /prd-qa to refine it.", "init", []);
}
