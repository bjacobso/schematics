import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/cli.ts", "src/deploy-cli-bin.ts"],
  format: "esm",
  target: "esnext",
  unbundle: true,
  fixedExtension: false,
  dts: { sourcemap: true },
  sourcemap: true,
  clean: true,
  outDir: "dist",
});
