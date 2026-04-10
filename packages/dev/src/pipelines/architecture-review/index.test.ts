import { describe, expect, it } from "vitest";
import { parseCandidates } from "./index.js";

describe("parseCandidates", () => {
  it("parses numbered markdown headings into label/body pairs", () => {
    const text = [
      "### 1. High coupling in auth module",
      "Auth is tightly coupled to the database layer.",
      "",
      "### 2. Missing error boundaries",
      "No error boundaries in the React tree.",
    ].join("\n");

    const result = parseCandidates(text);
    expect(result).toHaveLength(2);
    expect(result[0]?.label).toBe("1. High coupling in auth module");
    expect(result[0]?.body).toContain("Auth is tightly coupled");
    expect(result[1]?.label).toBe("2. Missing error boundaries");
    expect(result[1]?.body).toContain("No error boundaries");
  });

  it("returns empty array for input with no numbered headings", () => {
    expect(parseCandidates("")).toEqual([]);
    expect(parseCandidates("Just some text with no candidates")).toEqual([]);
  });
});
