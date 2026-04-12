import type { ExtensionConfig, PostRunActionHelpers } from "@callumvass/forgeflow-shared/extension";
import type { ForgeflowContext, PipelineDetails } from "@callumvass/forgeflow-shared/pipeline";
import type { AgentToolResult } from "@mariozechner/pi-agent-core";

type PipelineToolResult = AgentToolResult<PipelineDetails> & { isError?: boolean };

function textResult(result: PipelineToolResult): string {
  const first = result.content[0];
  return first?.type === "text" ? first.text : "";
}

function parsePrNumber(text: string): number | undefined {
  const match = text.match(/PR #(\d+)/);
  if (!match?.[1]) return undefined;
  const prNumber = Number(match[1]);
  return Number.isFinite(prNumber) && prNumber > 0 ? prNumber : undefined;
}

async function resolvePrUrl(prNumber: number, helpers: PostRunActionHelpers): Promise<string> {
  const result = await helpers.exec("gh", ["pr", "view", String(prNumber), "--json", "url", "--jq", ".url"]);
  return result.code === 0 ? result.stdout.trim() : "";
}

async function runImplementActions(
  args: Record<string, unknown>,
  result: PipelineToolResult,
  ctx: ForgeflowContext,
  helpers: PostRunActionHelpers,
): Promise<void> {
  const output = textResult(result);
  const prNumber = parsePrNumber(output);
  const options = [
    ...(prNumber ? ["Open PR in browser", "Copy PR URL to editor"] : []),
    ...(!result.isError && args.skipReview === true ? ["Queue /review now"] : []),
    "Open stages",
    "Close",
  ];
  const action = await ctx.ui.select("Implementation complete. What next?", options);
  if (!action || action === "Close") return;

  if (action === "Open PR in browser" && prNumber) {
    await helpers.exec("gh", ["pr", "view", String(prNumber), "--web"]);
    return;
  }

  if (action === "Copy PR URL to editor" && prNumber) {
    const url = await resolvePrUrl(prNumber, helpers);
    if (!url) {
      helpers.notify(`Could not resolve the URL for PR #${prNumber}.`, "warning");
      return;
    }
    ctx.ui.setEditorText?.(url);
    helpers.notify(`Copied PR #${prNumber} URL into the editor.`, "info");
    return;
  }

  if (action === "Queue /review now") {
    helpers.queueFollowUp(prNumber ? `/review ${prNumber}` : "/review");
    helpers.notify("Queued /review as a follow-up command.", "info");
    return;
  }

  if (action === "Open stages") {
    await helpers.openStages(result.details);
  }
}

async function resolveReviewPrNumber(
  args: Record<string, unknown>,
  helpers: PostRunActionHelpers,
): Promise<number | undefined> {
  const target = typeof args.target === "string" ? args.target.trim() : "";
  if (/^\d+$/.test(target)) return Number(target);

  const result = await helpers.exec("gh", ["pr", "view", "--json", "number", "--jq", ".number"]);
  const prNumber = result.code === 0 ? Number(result.stdout.trim()) : NaN;
  return Number.isFinite(prNumber) && prNumber > 0 ? prNumber : undefined;
}

async function runReviewActions(
  args: Record<string, unknown>,
  result: PipelineToolResult,
  ctx: ForgeflowContext,
  helpers: PostRunActionHelpers,
): Promise<void> {
  const prNumber = await resolveReviewPrNumber(args, helpers);
  const report = textResult(result);
  const options = [
    ...(report ? ["Copy report to editor"] : []),
    ...(prNumber ? ["Open PR in browser"] : []),
    "Open stages",
    "Close",
  ];
  const action = await ctx.ui.select("Review complete. What next?", options);
  if (!action || action === "Close") return;

  if (action === "Copy report to editor") {
    ctx.ui.setEditorText?.(report);
    helpers.notify("Copied the review report into the editor.", "info");
    return;
  }

  if (action === "Open PR in browser" && prNumber) {
    await helpers.exec("gh", ["pr", "view", String(prNumber), "--web"]);
    return;
  }

  if (action === "Open stages") {
    await helpers.openStages(result.details);
  }
}

export const handleDevResult: NonNullable<ExtensionConfig["onResult"]> = async (args, result, ctx, helpers) => {
  const pipeline = result.details?.pipeline;
  if (!pipeline || !ctx.hasUI) return;
  if (pipeline === "implement") {
    await runImplementActions(args, result, ctx, helpers);
    return;
  }
  if (pipeline === "review") {
    await runReviewActions(args, result, ctx, helpers);
  }
};
