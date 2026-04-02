import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerPrdPipeline } from "./prd-pipeline";
import { registerIssuePipeline } from "./issue-pipeline";
import { registerImplPipeline } from "./impl-pipeline";
import { registerReviewPipeline } from "./review-pipeline";

const extension: (pi: ExtensionAPI) => void = (pi) => {
  pi.registerFlag("autonomous", {
    description: "Run pipelines without approval gates",
    type: "boolean",
    default: false,
  });

  registerPrdPipeline(pi);
  registerIssuePipeline(pi);
  registerImplPipeline(pi);
  registerReviewPipeline(pi);
};

export default extension;
