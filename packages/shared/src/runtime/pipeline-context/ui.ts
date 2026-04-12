import type { SessionEntry } from "@mariozechner/pi-coding-agent";

/** Structural theme interface, subset of Pi's Theme class used by rendering. */
export interface ForgeflowTheme {
  fg(color: string, text: string): string;
  bold(text: string): string;
}

/** Notification severity levels accepted by `ForgeflowUI.notify`. */
export type ForgeflowNotifyLevel = "info" | "warning" | "error";

/** A minimal Component shape returned from `ForgeflowUI.custom` factories. */
export interface ForgeflowCustomComponent {
  render(width: number): string[];
  invalidate?(): void;
  handleInput?(data: string): void;
  dispose?(): void;
}

/** Minimal TUI handle passed to `ForgeflowUI.custom` factories. */
export interface ForgeflowTui {
  requestRender(): void;
}

/** Overlay positioning/sizing options passed through to pi. */
export interface ForgeflowOverlayOptions {
  anchor?: string;
  width?: string | number;
  maxHeight?: string | number;
  minWidth?: number;
  visible?: (width: number, height: number) => boolean;
}

/** Options accepted by `ForgeflowUI.custom`. */
export interface ForgeflowCustomOptions {
  overlay?: boolean;
  overlayOptions?: ForgeflowOverlayOptions;
}

/** Factory signature for `ForgeflowUI.custom`. */
export type ForgeflowCustomFactory<T> = (
  tui: ForgeflowTui,
  theme: ForgeflowTheme,
  keybindings: unknown,
  done: (result: T) => void,
) => ForgeflowCustomComponent | Promise<ForgeflowCustomComponent>;

/** Read-only view of the session used by the stages overlay. */
export interface ForgeflowSessionManager {
  getBranch(): SessionEntry[];
}

/** Subset of ExtensionUIContext that forgeflow actually uses. */
export interface ForgeflowUI {
  input(title: string, placeholder?: string): Promise<string | undefined>;
  editor(title: string, content: string): Promise<string | undefined>;
  select(title: string, options: string[]): Promise<string | undefined>;
  setStatus(key: string, text: string | undefined): void;
  setWidget(key: string, content: string[] | undefined): void;
  setFooter?: (
    factory:
      | ((
          tui: ForgeflowTui,
          theme: ForgeflowTheme,
          footerData: { getGitBranch?: () => string | null; onBranchChange?: (cb: () => void) => () => void },
        ) => ForgeflowCustomComponent & { dispose?(): void })
      | undefined,
  ) => void;
  setEditorText?(text: string): void;
  notify(message: string, level?: ForgeflowNotifyLevel): void;
  custom<T>(factory: ForgeflowCustomFactory<T>, options?: ForgeflowCustomOptions): Promise<T>;
  readonly theme: ForgeflowTheme;
}

/** What forgeflow actually needs from the extension context. */
export interface ForgeflowContext {
  hasUI: boolean;
  cwd: string;
  ui: ForgeflowUI;
  sessionManager: ForgeflowSessionManager;
}

export interface PipelineUiRuntime {
  ctx: ForgeflowContext;
}
