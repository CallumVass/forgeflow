import { registerPrdPipeline } from "./prd-pipeline";
import { registerIssuePipeline } from "./issue-pipeline";
import { registerImplPipeline } from "./impl-pipeline";
import { registerReviewPipeline } from "./review-pipeline";

export default function (pi: any) {
  // Register --autonomous flag (skip approval gates)
  pi.registerFlag("autonomous", {
    description: "Run pipelines without approval gates",
    type: "boolean",
    default: false,
  });

  registerPrdPipeline(pi);
  registerIssuePipeline(pi);
  registerImplPipeline(pi);
  registerReviewPipeline(pi);
}
