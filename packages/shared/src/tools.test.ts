import { describe, expect, it } from "vitest";
import { TOOLS_ALL, TOOLS_NO_EDIT, TOOLS_READONLY } from "./tools.js";

describe("tools constants", () => {
  it("exports correct tool-list arrays", () => {
    expect(TOOLS_ALL).toEqual(["read", "write", "edit", "bash", "grep", "find"]);
    expect(TOOLS_READONLY).toEqual(["read", "bash", "grep", "find"]);
    expect(TOOLS_NO_EDIT).toEqual(["read", "write", "bash", "grep", "find"]);
  });
});
