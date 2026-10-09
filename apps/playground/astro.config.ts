import { foldkit } from "@foldkit/vite-plugin";
import react from "@astrojs/react";
import { foldworksLayers } from "@foldworks/ui/vite";
import stylex from "@stylexjs/unplugin";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";
import { schematicsAliases } from "../../vitest.aliases";

const apiPort = process.env["SCHEMATICS_E2E_API_PORT"] ?? "4317";
const apiTarget = `http://127.0.0.1:${apiPort}`;

export default defineConfig({
  base: process.env["SCHEMATICS_PLAYGROUND_BASE"] ?? "/",
  site: "https://schematics.run",
  output: "static",
  integrations: [react()],
  server: { host: "127.0.0.1", port: 4318 },
  vite: {
    // Preserve the playground's existing public API URL and E2E clock settings.
    envPrefix: ["PUBLIC_", "VITE_"],
    plugins: [
      tailwindcss(),
      foldkit(),
      {
        // Astro's prerender entry needs exports-only signatures. Apply browser
        // chunk rules after Astro builds its client environment, keeping React
        // and editor vendors out of Foldkit islands and the initial homepage.
        name: "schematics-client-chunks",
        configEnvironment(name) {
          if (name !== "client") return;
          return {
            build: {
              rolldownOptions: {
                preserveEntrySignatures: "allow-extension",
                output: {
                  strictExecutionOrder: true,
                  codeSplitting: {
                    includeDependenciesRecursively: false,
                    groups: [
                      {
                        name: "react",
                        test: /node_modules\/(react|react-dom|scheduler)\//,
                        entriesAware: true,
                      },
                      {
                        name: "effect",
                        test: /node_modules\/(effect|@effect)\//,
                        entriesAware: true,
                      },
                      {
                        name: "codemirror",
                        test: /node_modules\/(@codemirror|@lezer)\//,
                        entriesAware: true,
                      },
                      { name: "mui", test: /node_modules\/(@mui|@emotion)\//, entriesAware: true },
                    ],
                  },
                },
              },
            },
          };
        },
      },
      stylex.vite({ runtimeInjection: false, useCSSLayers: { before: foldworksLayers } }),
    ],
    resolve: {
      dedupe: ["react", "react-dom"],
      alias: {
        ...schematicsAliases,
      },
    },
    // Foldworks ships StyleX expressions that must reach the transform.
    optimizeDeps: { exclude: ["@foldworks/ui", "@foldkit/ui", "foldkit"] },
    server: { proxy: { "/__schematics_e2e__": apiTarget, "/v1": apiTarget } },
  },
});
