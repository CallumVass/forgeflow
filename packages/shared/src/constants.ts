export const TOOLS_ALL = ["read", "write", "edit", "bash", "grep", "find"];
export const TOOLS_READONLY = ["read", "bash", "grep", "find"];
export const TOOLS_NO_EDIT = ["read", "write", "bash", "grep", "find"];

export const SIGNALS = {
  questions: "QUESTIONS.md",
  findings: "FINDINGS.md",
  blocked: "BLOCKED.md",
} as const;
