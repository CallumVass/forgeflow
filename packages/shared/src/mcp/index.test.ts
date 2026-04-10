import { describe, expect, it } from "vitest";
import { parseMcpJson } from "./index.js";

function mcpText(text: string) {
  return {
    content: [{ type: "text", text }],
  };
}

describe("parseMcpJson", () => {
  it("parses plain JSON text responses", () => {
    const result = parseMcpJson(mcpText('{"ok":true}'), "Test MCP");
    expect(result).toEqual({ ok: true });
  });

  it("extracts wrapped JSON payloads from tagged text responses", () => {
    const result = parseMcpJson(
      mcpText('<METADATA>\n  <url>https://example.com</url>\n</METADATA>\n<JSON_DATA>\n[{"value":42}]\n</JSON_DATA>'),
      "Test MCP",
    );

    expect(result).toEqual([{ value: 42 }]);
  });

  it("treats empty wrapped YAML payloads as an empty collection", () => {
    const result = parseMcpJson(mcpText("<METADATA>\n</METADATA>\n<YAML_DATA>\n</YAML_DATA>"), "Test MCP");
    expect(result).toEqual([]);
  });
});
