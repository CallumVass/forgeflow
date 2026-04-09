import { describe, expect, it } from "vitest";
import { buildSchema } from "./schema.js";
import type { ExtensionConfig } from "./types.js";

describe("buildSchema", () => {
  it("returns a TypeBox object schema with required pipeline and optional typed params", () => {
    const config: ExtensionConfig = {
      toolName: "forgeflow-test",
      toolLabel: "Forgeflow Test",
      description: "Test extension",
      params: {
        issue: { type: "string", description: "Issue number" },
        verbose: { type: "boolean", description: "Verbose output" },
        count: { type: "number", description: "Iteration count" },
      },
      pipelines: [
        { name: "alpha", execute: async () => ({ content: [], details: { pipeline: "alpha", stages: [] } }) },
        { name: "beta", execute: async () => ({ content: [], details: { pipeline: "beta", stages: [] } }) },
      ],
      commands: [],
    };

    const schema = buildSchema(config) as {
      type: string;
      properties: Record<string, { type: string; description?: string }>;
      required?: string[];
    };

    expect(schema.type).toBe("object");

    // pipeline is a required string whose description lists every available pipeline name
    expect(schema.properties.pipeline).toBeDefined();
    expect(schema.properties.pipeline?.type).toBe("string");
    expect(schema.properties.pipeline?.description).toContain("alpha");
    expect(schema.properties.pipeline?.description).toContain("beta");
    expect(schema.required).toEqual(["pipeline"]);

    // each config.params entry is a typed optional property
    expect(schema.properties.issue?.type).toBe("string");
    expect(schema.properties.verbose?.type).toBe("boolean");
    expect(schema.properties.count?.type).toBe("number");
  });
});
