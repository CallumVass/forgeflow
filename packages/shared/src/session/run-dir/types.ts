export interface RunDirHandle {
  runId: string;
  /** Absolute path to `.forgeflow/run/<runId>/`. */
  dir: string;
  /**
   * Allocate the next session path. Each call increments a private
   * counter and pre-creates an empty file at `0o600` so pi's subsequent
   * `--session <path>` writes never land in a world-readable file.
   */
  allocSessionPath: (agentName: string) => string;
}

export type ArchiveOutcome = "success" | "failed" | "cancelled";
