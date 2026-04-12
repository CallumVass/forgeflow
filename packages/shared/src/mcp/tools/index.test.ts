import { describe, expect, it } from "vitest";
import { parseMcpJson as parseMcpJsonFromPublicEntry } from "../index.js";
import { callMcpTool, parseMcpJson, resolveMcpTool } from "./index.js";

function mcpText(text: string) {
  return {
    content: [{ type: "text", text }],
  };
}

describe("parseMcpJson", () => {
  it("remains reachable through the MCP public entry point", () => {
    const result = parseMcpJsonFromPublicEntry(mcpText('{"ok":true}'), "Test MCP");
    expect(result).toEqual({ ok: true });
  });

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

describe("callMcpTool", () => {
  it("returns a service-labelled error when the tool call throws", async () => {
    const result = await callMcpTool(
      {
        client: {
          callTool: async () => {
            throw new Error("boom");
          },
        },
      } as never,
      "query-metrics",
      { query: "avg:system.load.1{*}" },
      "Test MCP",
    );

    expect(result).toBe("Test MCP tool query-metrics failed: boom");
  });
});

describe("resolveMcpTool", () => {
  it("prefers aliases and falls back to scored heuristics", () => {
    expect(
      resolveMcpTool(
        {
          toolNames: ["get_datadog_metric", "search_datadog_logs"],
          tools: [
            { name: "get_datadog_metric", description: "Get a Datadog metric timeseries" },
            { name: "search_datadog_logs", description: "Search Datadog logs" },
          ],
        },
        ["get_datadog_metric"],
        ["metric"],
        ["query", "timeseries"],
      ),
    ).toBe("get_datadog_metric");

    expect(
      resolveMcpTool(
        {
          toolNames: ["metric_dimensions", "trace_explorer"],
          tools: [
            { name: "metric_dimensions", description: "Inspect metric context, indexed tags and metadata" },
            { name: "trace_explorer", description: "Search spans and trace data in APM" },
          ],
        },
        ["missing_alias"],
        ["span"],
        ["search", "trace", "apm"],
        { requireOptionalMatch: true },
      ),
    ).toBe("trace_explorer");
  });
});
