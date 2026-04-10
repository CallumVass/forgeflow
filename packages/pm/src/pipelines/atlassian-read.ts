import { fetchAtlassianContentFromUrl, formatAtlassianContent } from "@callumvass/forgeflow-shared/atlassian/content";
import { type PipelineContext, pipelineResult, withRunLifecycle } from "@callumvass/forgeflow-shared/pipeline";

export async function runAtlassianRead(url: string, pctx: PipelineContext) {
  return withRunLifecycle(pctx, "atlassian-read", (innerPctx) => runAtlassianReadInner(url, innerPctx));
}

async function runAtlassianReadInner(url: string, pctx: PipelineContext) {
  const { ctx } = pctx;

  if (!url && ctx.hasUI) {
    const input = await ctx.ui.input("Atlassian URL?", "Paste Jira or Confluence URL");
    url = input?.trim() ?? "";
  }

  if (!url) {
    return pipelineResult("No Atlassian URL provided.", "atlassian-read", []);
  }

  const content = await fetchAtlassianContentFromUrl(url);
  if (typeof content === "string") {
    return pipelineResult(content, "atlassian-read", [], true);
  }

  return pipelineResult(formatAtlassianContent(content), "atlassian-read", []);
}
