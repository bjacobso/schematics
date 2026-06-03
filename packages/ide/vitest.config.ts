import { defineConfig } from "vitest/config";
import { schemaIdeAliases } from "../../vitest.aliases";

export default defineConfig({
  resolve: {
    alias: schemaIdeAliases,
  },
});
