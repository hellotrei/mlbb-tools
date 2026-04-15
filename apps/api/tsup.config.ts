import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  bundle: true,
  format: ["cjs"],
  outDir: "dist",
  splitting: false,
  clean: true,
  sourcemap: false,
  noExternal: [/.*/]
});
