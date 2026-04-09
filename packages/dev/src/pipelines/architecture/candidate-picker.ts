import type {
  ForgeflowContext,
  ForgeflowCustomComponent,
  ForgeflowTheme,
  ForgeflowTui,
} from "@callumvass/forgeflow-shared/pipeline";
import { Key, matchesKey, truncateToWidth } from "@mariozechner/pi-tui";
import type { ArchitectureCandidate } from "./index.js";

export async function pickArchitectureCandidates(
  ctx: ForgeflowContext,
  candidates: ArchitectureCandidate[],
): Promise<ArchitectureCandidate[] | null | undefined> {
  return ctx.ui.custom<ArchitectureCandidate[] | null | undefined>(
    (tui, theme, _keybindings, done) => createArchitectureCandidatePicker(candidates, tui, theme, done),
    {
      overlay: true,
      overlayOptions: {
        anchor: "center",
        width: "80%",
        maxHeight: "80%",
      },
    },
  );
}

function createArchitectureCandidatePicker(
  candidates: ArchitectureCandidate[],
  tui: ForgeflowTui,
  theme: ForgeflowTheme,
  done: (result: ArchitectureCandidate[] | null | undefined) => void,
): ForgeflowCustomComponent {
  let selectedIndex = 0;
  const enabled = new Set<number>();

  const requestRender = () => {
    tui.requestRender();
  };

  const confirm = () => {
    done(candidates.filter((_candidate, index) => enabled.has(index)));
  };

  const toggleCurrent = () => {
    if (enabled.has(selectedIndex)) enabled.delete(selectedIndex);
    else enabled.add(selectedIndex);
    requestRender();
  };

  return {
    render(width: number): string[] {
      const lines = [
        truncateToWidth(theme.fg("toolTitle", theme.bold("Create RFC issues")), width),
        truncateToWidth(theme.fg("muted", "Toggle candidates, then press Enter to confirm."), width),
        "",
      ];

      for (const [index, candidate] of candidates.entries()) {
        const cursor = index === selectedIndex ? theme.fg("accent", "›") : " ";
        const checkbox = enabled.has(index) ? theme.fg("accent", "[x]") : theme.fg("dim", "[ ]");
        const label = index === selectedIndex ? theme.fg("accent", candidate.label) : candidate.label;
        lines.push(truncateToWidth(`${cursor} ${checkbox} ${label}`, width));
      }

      lines.push("");
      lines.push(truncateToWidth(theme.fg("dim", "↑↓ navigate • space toggle • enter confirm • esc cancel"), width));
      return lines;
    },
    handleInput(data: string): void {
      if (matchesKey(data, Key.up)) {
        selectedIndex = selectedIndex === 0 ? candidates.length - 1 : selectedIndex - 1;
        requestRender();
        return;
      }
      if (matchesKey(data, Key.down)) {
        selectedIndex = selectedIndex === candidates.length - 1 ? 0 : selectedIndex + 1;
        requestRender();
        return;
      }
      if (matchesKey(data, Key.space) || data === " ") {
        toggleCurrent();
        return;
      }
      if (matchesKey(data, Key.enter) || matchesKey(data, Key.return)) {
        confirm();
        return;
      }
      if (matchesKey(data, Key.escape) || matchesKey(data, Key.esc) || matchesKey(data, Key.ctrl("c"))) {
        done(null);
      }
    },
  };
}
