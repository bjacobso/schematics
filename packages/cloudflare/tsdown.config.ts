import { defineConfig } from "tsdown";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/alchemy.ts",
    "src/worker-runtime.ts",
    "src/workspace-object.ts",
  ],
  format: "esm",
  target: "esnext",
  deps: {
    neverBundle: ["cloudflare:workers"],
  },
  unbundle: true,
  fixedExtension: false,
  dts: { sourcemap: true },
  sourcemap: true,
  clean: true,
  outDir: "dist",
});
