import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import { schematicsAliases } from "../../vitest.aliases";

const e2eApiPort = process.env["SCHEMATICS_E2E_API_PORT"] ?? "4317";
const e2eApiTarget = `http://127.0.0.1:${e2eApiPort}`;

export default defineConfig({
  base: process.env["SCHEMATICS_PLAYGROUND_BASE"] ?? "/",
  plugins: [tailwindcss()],
  resolve: {
    alias: {
      ...schematicsAliases,
      "react/jsx-runtime": resolve(import.meta.dirname, "node_modules/react/jsx-runtime.js"),
      react: resolve(import.meta.dirname, "node_modules/react"),
    },
  },
  build: {
    rolldownOptions: {
      output: {
        strictExecutionOrder: true,
        // Keep the landing entry separate from the lazy editor, including shared
        // vendor groups. Recursively capturing dependencies pulled the IDE into
        // the initial load even though PlaygroundApp is dynamically imported.
        codeSplitting: {
          includeDependenciesRecursively: false,
          groups: [
            {
              name: "react",
              test: /node_modules\/(react|react-dom|scheduler)\//,
              entriesAware: true,
            },
            {
              name: "codemirror",
              test: /node_modules\/(@codemirror|@lezer)\//,
              entriesAware: true,
            },
            { name: "effect", test: /node_modules\/(effect|@effect)\//, entriesAware: true },
            { name: "mui", test: /node_modules\/(@mui|@emotion)\//, entriesAware: true },
            { name: "icons", test: /node_modules\/lucide-react\//, entriesAware: true },
            { name: "pdf", test: /node_modules\/(pdf-lib|@pdf-lib)\//, entriesAware: true },
            { name: "yaml", test: /node_modules\/yaml\//, entriesAware: true },
            {
              name: "schematics-core",
              test: /\/packages\/(core|artifacts)\/src\//,
              entriesAware: true,
            },
            {
              name: "schematics-protocol",
              test: /\/packages\/protocol\/src\//,
              entriesAware: true,
            },
            { name: "schematics-agent", test: /\/packages\/agent\/src\//, entriesAware: true },
            { name: "schematics-examples", test: /\/examples\//, entriesAware: true },
            { name: "schematics-ide", test: /\/packages\/ide\/src\//, entriesAware: true },
          ],
        },
      },
    },
  },
  server: {
    host: "127.0.0.1",
    port: 4318,
    proxy: {
      "/__schematics_e2e__": e2eApiTarget,
      "/v1": e2eApiTarget,
    },
  },
});
