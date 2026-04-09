import { Type } from "@sinclair/typebox";
import type { ExtensionConfig, ParamDef } from "./types.js";

// ─── TypeBox schema construction ──────────────────────────────────────

function buildTypeBoxParam(def: ParamDef) {
  switch (def.type) {
    case "string":
      return Type.String({ description: def.description });
    case "number":
      return Type.Number({ description: def.description });
    case "boolean":
      return Type.Boolean({ description: def.description });
  }
}

/**
 * Build a TypeBox object schema for the forgeflow tool's parameters. The
 * `pipeline` property is always present and required; every entry in
 * `config.params` becomes an optional property of the matching primitive type.
 */
export function buildSchema(config: ExtensionConfig) {
  const pipelineNames = config.pipelines.map((p) => p.name);
  const pipelineDesc = `Which pipeline to run: ${pipelineNames.map((n) => `"${n}"`).join(", ")}`;

  const props: Record<string, unknown> = {
    pipeline: Type.String({ description: pipelineDesc }),
  };

  for (const [key, def] of Object.entries(config.params)) {
    props[key] = Type.Optional(buildTypeBoxParam(def));
  }

  return Type.Object(props as Record<string, ReturnType<typeof Type.String>>);
}
