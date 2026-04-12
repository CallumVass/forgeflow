import type { ForgeflowContext } from "@callumvass/forgeflow-shared/pipeline";
import { hydrateRememberedInvocations } from "../command-launchers/index.js";

interface SessionEntry {
  type: string;
  customType?: string;
  data?: unknown;
}

interface RememberedCommandPayload {
  toolName?: unknown;
  command?: unknown;
  params?: unknown;
}

interface RememberedCommandEntry {
  command?: unknown;
  params?: unknown;
}

export function readRememberedDevInvocations(ctx: Pick<ForgeflowContext, "sessionManager">): RememberedCommandEntry[] {
  const entries: SessionEntry[] =
    "getEntries" in ctx.sessionManager && typeof ctx.sessionManager.getEntries === "function"
      ? (ctx.sessionManager.getEntries() as SessionEntry[])
      : [];

  return entries
    .filter((entry) => entry.type === "custom" && entry.customType === "forgeflow-command")
    .map((entry) => (entry.data ?? {}) as RememberedCommandPayload)
    .filter((entry) => entry.toolName === "forgeflow-dev")
    .map((entry) => ({ command: entry.command, params: entry.params }));
}

export function restoreDevSessionState(
  ctx: Pick<ForgeflowContext, "sessionManager">,
  hydrate: (entries: RememberedCommandEntry[]) => void = hydrateRememberedInvocations,
): void {
  hydrate(readRememberedDevInvocations(ctx));
}
