import { describe, expect, it } from "vitest";
import { extractFlags, splitFirstToken, unquote } from "./arg-parsing.js";

describe("extractFlags", () => {
  it("extracts boolean flags, value flags, and returns the remaining positional text", () => {
    // Empty string
    expect(extractFlags("", {})).toEqual({ flags: {}, rest: "" });

    // Boolean flags only
    expect(extractFlags("--skip-plan --skip-review", { boolean: ["--skip-plan", "--skip-review"] })).toEqual({
      flags: { "--skip-plan": true, "--skip-review": true },
      rest: "",
    });

    // Boolean flag mixed with positional args
    expect(extractFlags("42 --skip-plan some text", { boolean: ["--skip-plan"] })).toEqual({
      flags: { "--skip-plan": true },
      rest: "42 some text",
    });

    // Value flags
    expect(extractFlags("--template https://example.com description text", { value: ["--template"] })).toEqual({
      flags: { "--template": "https://example.com" },
      rest: "description text",
    });

    // Value flag at end of string (no value after it)
    expect(extractFlags("some text --branch", { value: ["--branch"] })).toEqual({
      flags: {},
      rest: "some text --branch",
    });

    // Mixed boolean and value flags with positional args
    expect(
      extractFlags("42 --skip-plan --branch main check bugs", {
        boolean: ["--skip-plan"],
        value: ["--branch"],
      }),
    ).toEqual({
      flags: { "--skip-plan": true, "--branch": "main" },
      rest: "42 check bugs",
    });

    // Value flag with multiple positional args around it
    expect(extractFlags("url1 url2 --example ex-url url3", { value: ["--example"] })).toEqual({
      flags: { "--example": "ex-url" },
      rest: "url1 url2 url3",
    });

    // Flag not present returns empty flags
    expect(extractFlags("just positional args", { boolean: ["--verbose"], value: ["--output"] })).toEqual({
      flags: {},
      rest: "just positional args",
    });
  });
});

describe("splitFirstToken", () => {
  it("splits first whitespace-delimited token from the rest of the string", () => {
    expect(splitFirstToken("")).toEqual({ first: "", rest: "" });
    expect(splitFirstToken("hello")).toEqual({ first: "hello", rest: "" });
    expect(splitFirstToken("hello world")).toEqual({ first: "hello", rest: "world" });
    expect(splitFirstToken("42 some custom prompt")).toEqual({ first: "42", rest: "some custom prompt" });
    expect(splitFirstToken("  spaced  ")).toEqual({ first: "spaced", rest: "" });
  });
});

describe("unquote", () => {
  it("strips surrounding double quotes and leaves other strings unchanged", () => {
    expect(unquote("")).toBe("");
    expect(unquote("hello")).toBe("hello");
    expect(unquote('"hello world"')).toBe("hello world");
    expect(unquote('"only opening')).toBe('"only opening');
    expect(unquote("no quotes")).toBe("no quotes");
    expect(unquote('"nested "quotes""')).toBe('nested "quotes"');
  });
});
