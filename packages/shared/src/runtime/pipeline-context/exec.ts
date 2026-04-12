import { type ExecFn, exec, execSafe } from "../../io/index.js";

export type { ExecFn } from "../../io/index.js";

export interface PipelineExecRuntime {
  cwd: string;
  execFn: ExecFn;
  execSafeFn: ExecFn;
}

export const defaultExecRuntime = {
  execFn: exec,
  execSafeFn: execSafe,
};
