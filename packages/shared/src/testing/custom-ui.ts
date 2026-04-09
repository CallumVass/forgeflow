import { type Mock, vi } from "vitest";
import type { ForgeflowCustomFactory, ForgeflowCustomOptions, ForgeflowUI } from "../pipeline.js";

export interface CustomCapture<T> {
  factory: ForgeflowCustomFactory<T>;
  options: ForgeflowCustomOptions | undefined;
  done: (result: T) => void;
  tui: { requestRender: ReturnType<typeof vi.fn> };
}

/**
 * Create a typed `ctx.ui.custom` mock and capture its factory so tests can
 * mount the component and drive it directly.
 */
export function makeCustomUiMock<T>() {
  const captures: CustomCapture<T>[] = [];
  const customFn = vi.fn(async (factory: ForgeflowCustomFactory<T>, options?: ForgeflowCustomOptions) => {
    let resolvePromise: (result: T) => void = () => {};
    const promise = new Promise<T>((resolve) => {
      resolvePromise = resolve;
    });
    const tui = { requestRender: vi.fn() };
    const done = vi.fn((result: T) => {
      resolvePromise(result);
    });
    captures.push({ factory, options, done, tui });
    return promise;
  });

  return {
    custom: customFn as unknown as Mock<ForgeflowUI["custom"]> & ForgeflowUI["custom"],
    captures,
  };
}

export function firstCustomCapture<T>(captures: CustomCapture<T>[]): CustomCapture<T> {
  const capture = captures[0];
  if (!capture) throw new Error("expected at least one ctx.ui.custom call");
  return capture;
}
