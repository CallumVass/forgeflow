import type { ForgeflowContext } from "@callumvass/forgeflow-shared/types";

export function setForgeflowStatus(ctx: ForgeflowContext, text: string | undefined): void {
  if (ctx.hasUI) ctx.ui.setStatus("forgeflow-dev", text);
}

function setForgeflowWidget(ctx: ForgeflowContext, lines: string[] | undefined): void {
  if (ctx.hasUI) ctx.ui.setWidget("forgeflow-dev", lines);
}

export function updateProgressWidget(
  ctx: ForgeflowContext,
  progress: Map<number, { title: string; status: string }>,
  totalCost: number,
): void {
  let done = 0;
  for (const [, info] of progress) {
    if (info.status === "done") done++;
  }
  let header = `implement-all · ${done}/${progress.size}`;
  if (totalCost > 0) header += ` · $${totalCost.toFixed(2)}`;
  const lines: string[] = [header];
  for (const [num, info] of progress) {
    const icon = info.status === "done" ? "✓" : info.status === "running" ? "⟳" : info.status === "failed" ? "✗" : "○";
    const title = info.title.length > 50 ? `${info.title.slice(0, 50)}...` : info.title;
    lines.push(`  ${icon} #${num} ${title}`);
  }
  setForgeflowWidget(ctx, lines);
}
