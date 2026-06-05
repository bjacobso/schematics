import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import { schematicsAliases } from "../../vitest.aliases";

const e2eApiPort = process.env["SCHEMATICS_E2E_API_PORT"] ?? "4317";
const e2eApiTarget = `http://127.0.0.1:${e2eApiPort}`;

export default defineConfig({
  base: process.env["SCHEMATICS_IDE_BASE"] ?? "/",
  plugins: [tailwindcss()],
  resolve: {
    alias: {
      ...schematicsAliases,
      "react/jsx-runtime": resolve(import.meta.dirname, "node_modules/react/jsx-runtime.js"),
      react: resolve(import.meta.dirname, "node_modules/react"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/@codemirror/") || id.includes("node_modules/@lezer/")) {
            return "codemirror";
          }

          if (id.includes("node_modules/effect/") || id.includes("node_modules/@effect/")) {
            return "effect";
          }

          if (id.includes("node_modules/react") || id.includes("node_modules/scheduler/")) {
            return "react";
          }

          if (id.includes("node_modules/@mui/") || id.includes("node_modules/@emotion/")) {
            return "mui";
          }

          if (id.includes("node_modules/lucide-react/")) {
            return "icons";
          }

          if (id.includes("node_modules/pdf-lib/") || id.includes("node_modules/@pdf-lib/")) {
            return "pdf";
          }

          if (id.includes("node_modules/yaml/")) {
            return "yaml";
          }

          if (id.includes("/packages/core/src/") || id.includes("/packages/artifacts/src/")) {
            return "schematics-core";
          }

          if (id.includes("/packages/protocol/src/")) {
            return "schematics-protocol";
          }

          if (id.includes("/packages/agent/src/")) {
            return "schematics-agent";
          }

          if (id.includes("/packages/ide/src/")) {
            return "schematics-ide";
          }

          return undefined;
        },
      },
    },
  },
  server: {
    host: "127.0.0.1",
    port: 4318,
    proxy: {
      "/v1": e2eApiTarget,
    },
  },
});
