import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(fileURLToPath(import.meta.url));

export const schemaIdeAliases = {
  "@schema-ide/agent": resolve(rootDir, "packages/agent/src/index.ts"),
  "@schema-ide/cli": resolve(rootDir, "packages/cli/src/index.ts"),
  "@schema-ide/core": resolve(rootDir, "packages/core/src/index.ts"),
  "@schema-ide/examples": resolve(rootDir, "packages/examples/src/index.ts"),
  "@schema-ide/protocol": resolve(rootDir, "packages/protocol/src/index.ts"),
  "@schema-ide/react": resolve(rootDir, "packages/react/src/index.ts"),
  "@schema-ide/server": resolve(rootDir, "packages/server/src/index.ts"),
  "@schema-ide/ui": resolve(rootDir, "packages/ui/src/index.ts"),
};
