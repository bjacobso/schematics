import { defineConfig } from "vitest/config";
import { schematicsAliases } from "../../vitest.aliases";

export default defineConfig({
  resolve: {
    alias: schematicsAliases,
  },
});
