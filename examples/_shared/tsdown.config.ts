import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/node.ts", "src/preview.tsx"],
  format: "esm",
  target: "esnext",
  unbundle: true,
  fixedExtension: false,
  dts: { sourcemap: true },
  sourcemap: true,
  clean: true,
  outDir: "dist",
});
