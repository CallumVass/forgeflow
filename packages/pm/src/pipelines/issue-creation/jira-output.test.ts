import { describe, expect, it } from "vitest";
import { parseJiraIssueDrafts } from "./jira-output.js";

describe("parseJiraIssueDrafts", () => {
  it("parses fenced JSON arrays into Jira issue drafts", () => {
    const result = parseJiraIssueDrafts(
      [
        "```json",
        "[",
        '  { "summary": "Add dashboard filters", "description": "## Description\\nUsers can filter the dashboard.", "issueType": "Story" }',
        "]",
        "```",
      ].join("\n"),
    );

    expect(result).toEqual([
      {
        summary: "Add dashboard filters",
        description: "## Description\nUsers can filter the dashboard.",
        issueType: "Story",
      },
    ]);
  });

  it("returns a readable error when the planner output is not valid JSON", () => {
    expect(parseJiraIssueDrafts("not json")).toContain("valid JSON");
  });
});
