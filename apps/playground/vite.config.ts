import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import { schemaIdeAliases } from "../../vitest.aliases";

export default defineConfig({
  base: process.env["SCHEMA_IDE_PLAYGROUND_BASE"] ?? "/",
  plugins: [tailwindcss()],
  resolve: {
    alias: {
      ...schemaIdeAliases,
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

          if (id.includes("/packages/react/src/")) {
            return "schema-ide-react";
          }
        },
      },
    },
  },
  server: {
    host: "127.0.0.1",
    port: 4318,
    proxy: {
      "/v1": "http://127.0.0.1:4317",
    },
  },
});
