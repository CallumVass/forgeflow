import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  outDir: "extensions",
  format: ["esm"],
  platform: "node",
  target: "es2022",
  splitting: false,
  sourcemap: false,
  dts: false,
  clean: true,
  noExternal: ["@callumvass/forgeflow-shared"],
  outExtension: () => ({ js: ".js" }),
});
