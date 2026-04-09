// Public session lifecycle surface used by the runtime context and tests.

export type { ArchiveOutcome } from "./archive.js";
export { archiveRunDir, gcArchive } from "./archive.js";
export type { RunDirHandle } from "./create.js";
export { createRunDir } from "./create.js";
export { ensureGitignore, RUN_DIR_GITIGNORE_LINE } from "./fs.js";
export { withRunLifecycle } from "./lifecycle.js";
