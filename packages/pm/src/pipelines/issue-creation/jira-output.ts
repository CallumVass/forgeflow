import type { JiraIssueDraft } from "@callumvass/forgeflow-shared/atlassian/jira";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractJsonBlock(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fenced?.[1]?.trim() || text.trim();
}

export function parseJiraIssueDrafts(text: string): JiraIssueDraft[] | string {
  const jsonText = extractJsonBlock(text);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return "Jira issue planner did not return valid JSON.";
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    return "Jira issue planner returned no issue drafts.";
  }

  const drafts: JiraIssueDraft[] = [];
  for (const entry of parsed) {
    if (!isRecord(entry)) return "Jira issue planner emitted a non-object issue draft.";
    const summary = typeof entry.summary === "string" ? entry.summary.trim() : "";
    const description = typeof entry.description === "string" ? entry.description.trim() : "";
    const issueType =
      typeof entry.issueType === "string" && entry.issueType.trim() ? entry.issueType.trim() : undefined;
    if (!summary) return "Jira issue planner emitted an issue without a summary.";
    if (!description) return `Jira issue planner emitted an empty description for "${summary}".`;
    drafts.push({ summary, description, ...(issueType ? { issueType } : {}) });
  }

  return drafts;
}
