import type { SessionEntry } from "@mariozechner/pi-coding-agent";
import { Container, Key, matchesKey, type SelectItem, SelectList, Spacer, Text } from "@mariozechner/pi-tui";
import type { ForgeflowContext, ForgeflowCustomComponent, ForgeflowTheme, ForgeflowTui } from "./context.js";
import { formatUsage } from "./display.js";
import { appendStageDetail, stageIcon } from "./stage-renderer.js";
import type { PipelineDetails, StageResult } from "./stages.js";

// ─── Constants ────────────────────────────────────────────────────────

/** Minimum terminal width at which the overlay is allowed to render. */
const STAGES_OVERLAY_MIN_WIDTH = 80;

/** How often the overlay re-reads the session to pick up in-flight pipeline updates. */
const LIVE_UPDATE_INTERVAL_MS = 250;

const NO_PIPELINE_NOTIFICATION = "No forgeflow pipeline in this session yet";
const UNAVAILABLE_NOTIFICATION = "Stages overlay is only available in interactive mode";

// ─── Lookup ───────────────────────────────────────────────────────────

function isPipelineDetails(value: unknown): value is PipelineDetails {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { pipeline?: unknown; stages?: unknown };
  return typeof candidate.pipeline === "string" && Array.isArray(candidate.stages);
}

/**
 * Walk `entries` in reverse and return the `details` of the most recent
 * tool-result message whose `toolName` is in `toolNames`. Malformed entries
 * (missing `pipeline` string or `stages` array) are skipped.
 */
export function findLatestPipelineDetails(entries: SessionEntry[], toolNames: string[]): PipelineDetails | undefined {
  const allowed = new Set(toolNames);
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (!entry || entry.type !== "message") continue;
    const message = (entry as { message?: { role?: string; toolName?: string; details?: unknown } }).message;
    if (!message || message.role !== "toolResult") continue;
    if (!message.toolName || !allowed.has(message.toolName)) continue;
    if (isPipelineDetails(message.details)) return message.details;
  }
  return undefined;
}

// ─── Rendering helpers ────────────────────────────────────────────────

function buildListItems(details: PipelineDetails, theme: ForgeflowTheme): SelectItem[] {
  return details.stages.map((stage, index) => {
    const icon = stageIcon(stage, theme);
    const running = stage.status === "running" ? theme.fg("warning", " (running)") : "";
    const usage = formatUsage(stage.usage, stage.model);
    const description = usage || (stage.status === "pending" ? "pending" : "");
    return {
      value: String(index),
      label: `${icon} ${theme.fg("toolTitle", stage.name)}${running}`,
      description,
    };
  });
}

function buildDetailView(details: PipelineDetails, stage: StageResult, theme: ForgeflowTheme): Container {
  const container = new Container();
  container.addChild(
    new Text(theme.fg("toolTitle", theme.bold(`${details.pipeline} `)) + theme.fg("muted", "/ stage"), 0, 0),
  );
  container.addChild(new Spacer(1));
  appendStageDetail(container, stage, theme);
  container.addChild(new Spacer(1));
  container.addChild(new Text(theme.fg("dim", "esc back to list"), 0, 0));
  return container;
}

function buildListContainer(details: PipelineDetails, theme: ForgeflowTheme, selectList: SelectList): Container {
  const container = new Container();
  container.addChild(
    new Text(theme.fg("toolTitle", theme.bold(`${details.pipeline} `)) + theme.fg("accent", "stages"), 0, 0),
  );
  container.addChild(new Spacer(1));
  container.addChild(selectList);
  container.addChild(new Spacer(1));
  container.addChild(new Text(theme.fg("dim", "↑↓ navigate • enter view • esc close"), 0, 0));
  return container;
}

// ─── Public API ───────────────────────────────────────────────────────

/**
 * Open the interactive "stages" overlay for the most recent forgeflow tool
 * result in the current session. Resolves when the overlay is closed.
 *
 * No-ops (with a notification) when:
 * - the ctx is non-interactive (`hasUI === false`)
 * - no forgeflow pipeline tool result exists in the current branch
 */
export async function openStagesOverlay(ctx: ForgeflowContext, toolNames: string[]): Promise<void> {
  if (!ctx.hasUI) {
    ctx.ui.notify(UNAVAILABLE_NOTIFICATION, "info");
    return;
  }

  const initialDetails = findLatestPipelineDetails(ctx.sessionManager.getBranch(), toolNames);
  if (!initialDetails) {
    ctx.ui.notify(NO_PIPELINE_NOTIFICATION, "info");
    return;
  }

  await ctx.ui.custom<undefined>(
    (tui, theme, _keybindings, done) => createStagesOverlayComponent(ctx, toolNames, initialDetails, tui, theme, done),
    {
      overlay: true,
      overlayOptions: {
        anchor: "center",
        width: "80%",
        maxHeight: "80%",
        visible: (width: number) => width >= STAGES_OVERLAY_MIN_WIDTH,
      },
    },
  );
}

/**
 * Build the interactive overlay component. Exported for direct use by tests
 * and by command/shortcut wiring in `extension.ts`.
 */
function createStagesOverlayComponent(
  ctx: ForgeflowContext,
  toolNames: string[],
  initialDetails: PipelineDetails,
  tui: ForgeflowTui,
  theme: ForgeflowTheme,
  done: (result: undefined) => void,
): ForgeflowCustomComponent {
  let details: PipelineDetails = initialDetails;
  let mode: "list" | "detail" = "list";
  /** The user-highlighted stage in list mode (tracked via SelectList.onSelectionChange). */
  let highlightedStageIndex = 0;
  /** The stage chosen with Enter (used for the detail view). */
  let detailStageIndex = 0;
  let disposed = false;

  const onStagePicked = (item: SelectItem) => {
    const index = Number(item.value);
    if (Number.isNaN(index) || index < 0 || index >= details.stages.length) return;
    detailStageIndex = index;
    highlightedStageIndex = index;
    mode = "detail";
    tui.requestRender();
  };

  const onListCancelled = () => {
    close();
  };

  const onHighlightChange = (item: SelectItem) => {
    const index = Number(item.value);
    if (!Number.isNaN(index)) highlightedStageIndex = index;
  };

  const buildList = (): { selectList: SelectList; container: Container } => {
    const list = buildSelectList(details, theme, onStagePicked, onListCancelled, onHighlightChange);
    const clampedIndex = Math.min(highlightedStageIndex, Math.max(details.stages.length - 1, 0));
    list.setSelectedIndex(clampedIndex);
    const container = buildListContainer(details, theme, list);
    return { selectList: list, container };
  };

  let { selectList, container: listContainer } = buildList();

  const refreshListView = () => {
    ({ selectList, container: listContainer } = buildList());
  };

  const interval = setInterval(() => {
    if (disposed) return;
    const latest = findLatestPipelineDetails(ctx.sessionManager.getBranch(), toolNames);
    if (!latest) return;
    // Either a brand-new PipelineDetails object or an in-place mutation:
    // either way, refresh the list view and redraw.
    details = latest;
    refreshListView();
    tui.requestRender();
  }, LIVE_UPDATE_INTERVAL_MS);

  function close() {
    if (disposed) return;
    disposed = true;
    clearInterval(interval);
    done(undefined);
  }

  return {
    render(width: number): string[] {
      if (mode === "detail") {
        const stage = details.stages[detailStageIndex];
        if (!stage) {
          mode = "list";
          return listContainer.render(width);
        }
        const detailContainer = buildDetailView(details, stage, theme);
        return detailContainer.render(width);
      }
      return listContainer.render(width);
    },
    invalidate() {
      listContainer.invalidate();
    },
    handleInput(data: string): void {
      if (mode === "detail") {
        if (matchesKey(data, Key.escape)) {
          mode = "list";
          tui.requestRender();
          return;
        }
        return;
      }
      // List mode: forward to SelectList. If the user pressed Esc the
      // SelectList invokes onCancel → close().
      selectList.handleInput(data);
      tui.requestRender();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearInterval(interval);
    },
  };
}

function buildSelectList(
  details: PipelineDetails,
  theme: ForgeflowTheme,
  onSelect: (item: SelectItem) => void,
  onCancel: () => void,
  onSelectionChange: (item: SelectItem) => void,
): SelectList {
  const items = buildListItems(details, theme);
  const maxVisible = Math.max(1, Math.min(items.length, 10));
  const selectList = new SelectList(items, maxVisible, {
    selectedPrefix: (t) => theme.fg("accent", t),
    selectedText: (t) => theme.fg("accent", t),
    description: (t) => theme.fg("muted", t),
    scrollInfo: (t) => theme.fg("dim", t),
    noMatch: (t) => theme.fg("warning", t),
  });
  selectList.onSelect = onSelect;
  selectList.onCancel = onCancel;
  selectList.onSelectionChange = onSelectionChange;
  return selectList;
}
