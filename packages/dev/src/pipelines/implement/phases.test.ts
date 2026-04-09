import { describe, expect, it } from "vitest";
import { makeGitHubResolvedIssue, makeJiraResolvedIssue } from "../../issues/tracker.fixtures.js";
import { buildImplementorPrompt } from "./phases.js";

describe("buildImplementorPrompt — cold-start shape", () => {
  it("includes full issue context, plan, branch note, and Closes # for a GitHub issue", () => {
    const result = buildImplementorPrompt({
      issueContext: "Issue #42: Test issue\n\nIssue body",
      plan: "test plan",
      customPrompt: undefined,
      resolved: makeGitHubResolvedIssue(),
      isColdStart: true,
    });

    expect(result).toContain("Issue #42: Test issue");
    expect(result).toContain("Issue body");
    expect(result).toContain("IMPLEMENTATION PLAN:\ntest plan");
    expect(result).toContain("You should be on branch: feat/issue-42");
    expect(result).toContain("Closes #42");
  });

  it("references the Jira key and omits Closes # for a Jira issue", () => {
    const result = buildImplementorPrompt({
      issueContext: "Jira CUS-123: Jira issue\n\nJira body",
      plan: "",
      customPrompt: undefined,
      resolved: makeJiraResolvedIssue(),
      isColdStart: true,
    });

    expect(result).toContain("Jira CUS-123: Jira issue");
    expect(result).toContain("Jira body");
    expect(result).not.toContain("Closes #");
    expect(result).toContain("reference Jira issue CUS-123");
  });

  it("includes customPrompt and the autonomous unresolved-questions note when requested", () => {
    const result = buildImplementorPrompt({
      issueContext: "Issue #1: Test\n\nBody",
      plan: "some plan",
      customPrompt: "Extra instructions here",
      resolved: makeGitHubResolvedIssue({ number: 1, key: "1", branch: "feat/issue-1" }),
      autonomous: true,
      isColdStart: true,
    });

    expect(result).toContain("ADDITIONAL INSTRUCTIONS FROM USER:\nExtra instructions here");
    expect(result).toContain("resolve them yourself using sensible defaults");
  });

  it("omits the unresolved-questions note when not autonomous", () => {
    const result = buildImplementorPrompt({
      issueContext: "ctx",
      plan: "plan",
      customPrompt: undefined,
      resolved: makeGitHubResolvedIssue(),
      autonomous: false,
      isColdStart: true,
    });

    expect(result).not.toContain("resolve them yourself using sensible defaults");
  });
});

describe("buildImplementorPrompt — forked shape (isColdStart=false)", () => {
  it("does NOT inline the issue context, plan, or custom prompt — those come from fork history", () => {
    const result = buildImplementorPrompt({
      issueContext: "Issue #42: Test issue\n\nIssue body",
      plan: "test plan",
      customPrompt: "Extra instructions here",
      resolved: makeGitHubResolvedIssue(),
      isColdStart: false,
    });

    expect(result).not.toContain("Issue #42: Test issue");
    expect(result).not.toContain("IMPLEMENTATION PLAN:");
    expect(result).not.toContain("ADDITIONAL INSTRUCTIONS FROM USER");
    expect(result).toContain("Implement the plan you see in this session's prior turns");
  });

  it("keeps the branch, Closes #, and autonomous-constraint notes because they bind behaviour", () => {
    const result = buildImplementorPrompt({
      issueContext: "anything",
      plan: "anything",
      customPrompt: undefined,
      resolved: makeGitHubResolvedIssue(),
      autonomous: true,
      isColdStart: false,
    });

    expect(result).toContain("You should be on branch: feat/issue-42");
    expect(result).toContain("Closes #42");
    expect(result).toContain("resolve them yourself using sensible defaults");
    expect(result).toContain("If blocked, write BLOCKED.md");
  });

  it("teaches the implementor to distinguish inherited tool results from inherited reasoning", () => {
    const result = buildImplementorPrompt({
      issueContext: "ctx",
      plan: "plan",
      customPrompt: undefined,
      resolved: makeGitHubResolvedIssue(),
      isColdStart: false,
    });

    // Anti-anchoring preamble from the #133 mitigation, inlined into
    // the task prompt so it always fires on forked phases.
    expect(result).toContain("tool results");
    expect(result).toContain("ground truth");
    expect(result).toContain("working notes");
  });
});
