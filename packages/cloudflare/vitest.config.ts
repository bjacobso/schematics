import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { schematicsAliases } from "../../vitest.aliases";

export default defineConfig({
  resolve: {
    alias: {
      // The `cloudflare:workers` runtime module only resolves inside Workers;
      // stub it so the portable service logic can be unit-tested under node.
      "cloudflare:workers": fileURLToPath(
        new URL("./test/cloudflare-workers-stub.ts", import.meta.url),
      ),
      // Subpath export not covered by the bare-specifier aliases below.
      "@schematics/server/artifact-project-rpc": fileURLToPath(
        new URL("../server/src/artifact-project-rpc.ts", import.meta.url),
      ),
      ...schematicsAliases,
    },
  },
});
