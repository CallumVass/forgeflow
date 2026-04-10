import { describe, expect, it } from "vitest";
import * as barrel from "./index.js";

describe("Atlassian compatibility barrel", () => {
  it("re-exports the split Jira, Confluence, and content entry points", () => {
    expect(barrel).toHaveProperty("fetchJiraIssueViaOauth");
    expect(barrel).toHaveProperty("createJiraIssueViaOauth");
    expect(barrel).toHaveProperty("fetchConfluencePageViaOauth");
    expect(barrel).toHaveProperty("fetchAtlassianContentFromUrl");
    expect(barrel).toHaveProperty("formatAtlassianContent");
  });
});
