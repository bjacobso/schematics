import { foldkit } from "@foldkit/vite-plugin";
import stylex from "@stylexjs/unplugin";
import { defineConfig } from "vite";
import { schematicsAliases } from "../../vitest.aliases";

const e2eApiPort = process.env["SCHEMATICS_E2E_API_PORT"] ?? "4317";
const e2eApiTarget = `http://127.0.0.1:${e2eApiPort}`;

export default defineConfig(({ mode }) => ({
  base: process.env["SCHEMATICS_IDE_BASE"] ?? "/",
  plugins: [
    stylex.vite({
      dev: mode === "development",
      runtimeInjection: false,
      useCSSLayers: true,
    }),
    foldkit(),
  ],
  resolve: { alias: schematicsAliases },
  optimizeDeps: {
    exclude: ["@foldkit/ui", "@foldworks/ui", "effect", "foldkit"],
  },
  server: {
    host: "127.0.0.1",
    port: 4318,
    proxy: { "/v1": e2eApiTarget },
  },
}));
