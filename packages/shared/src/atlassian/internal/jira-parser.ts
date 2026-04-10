import { adfToPlainText, normalisePlainText } from "../adf.js";
import type { JiraCreatedIssue, JiraIssue } from "../jira/types.js";
import { isRecord, normaliseOrigin } from "./deps.js";

function extractTextField(fields: Record<string, unknown>, names: Record<string, string>, patterns: RegExp[]): string {
  for (const [fieldId, fieldName] of Object.entries(names)) {
    if (!patterns.some((pattern) => pattern.test(fieldName))) continue;
    const value = fields[fieldId];
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    const text = adfToPlainText(value);
    if (text) return text;
  }
  return "";
}

export function parseJiraIssueResponse(data: unknown, jiraKey: string): JiraIssue | string {
  if (!isRecord(data)) return `Unexpected Jira response for issue ${jiraKey}.`;

  const nested = isRecord(data.issue) ? data.issue : isRecord(data.result) ? data.result : data;
  if (typeof nested.body === "string" || typeof nested.description === "string") {
    return {
      key: typeof nested.key === "string" ? nested.key : jiraKey,
      title:
        typeof nested.title === "string" ? nested.title : typeof nested.summary === "string" ? nested.summary : jiraKey,
      body: normalisePlainText(String(nested.body ?? nested.description ?? "")),
      issueType:
        typeof nested.issueType === "string"
          ? nested.issueType
          : typeof nested.type === "string"
            ? nested.type
            : undefined,
    };
  }

  const fields = isRecord(nested.fields) ? nested.fields : {};
  const names = isRecord(nested.names)
    ? Object.fromEntries(
        Object.entries(nested.names).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
      )
    : {};
  const title = typeof fields.summary === "string" ? fields.summary : jiraKey;
  const description = typeof fields.description === "string" ? fields.description : adfToPlainText(fields.description);
  const acceptanceCriteria = extractTextField(fields, names, [/acceptance criteria/i]);
  const storyPoints = extractTextField(fields, names, [/story points?/i, /story point estimate/i]);
  const sprint = extractTextField(fields, names, [/sprint/i]);
  const issueType =
    isRecord(fields.issuetype) && typeof fields.issuetype.name === "string" ? fields.issuetype.name : undefined;

  const bodyParts = [description];
  if (acceptanceCriteria) bodyParts.push(`## Acceptance Criteria\n${acceptanceCriteria}`);
  if (isRecord(fields.status) && typeof fields.status.name === "string") {
    bodyParts.push(`**Status:** ${fields.status.name}`);
  }
  if (isRecord(fields.priority) && typeof fields.priority.name === "string") {
    bodyParts.push(`**Priority:** ${fields.priority.name}`);
  }
  if (storyPoints) bodyParts.push(`**Story Points:** ${storyPoints}`);
  if (sprint) bodyParts.push(`**Sprint:** ${sprint}`);

  return {
    key: typeof nested.key === "string" ? nested.key : jiraKey,
    title,
    body: normalisePlainText(bodyParts.filter(Boolean).join("\n\n")),
    issueType,
  };
}

export function parseJiraCreateResponse(data: unknown, summary: string, siteUrl?: string): JiraCreatedIssue | string {
  if (!isRecord(data)) return `Unexpected Jira create response for ${summary}.`;

  const nested = isRecord(data.issue) ? data.issue : isRecord(data.createdIssue) ? data.createdIssue : data;
  const key = typeof nested.key === "string" ? nested.key : "";
  const id = typeof nested.id === "string" ? nested.id : "";
  const url =
    typeof nested.url === "string" ? nested.url : key && siteUrl ? `${normaliseOrigin(siteUrl)}/browse/${key}` : key;
  if (!key || !id) return `Jira create response for ${summary} did not include id/key.`;

  return { id, key, url };
}
