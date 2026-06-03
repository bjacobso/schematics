import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(fileURLToPath(import.meta.url));

export const schematicsAliases = {
  "@schematics/agent": resolve(rootDir, "packages/agent/src/index.ts"),
  "@schematics/artifacts": resolve(rootDir, "packages/artifacts/src/index.ts"),
  "@schematics/cli": resolve(rootDir, "packages/cli/src/index.ts"),
  "@schematics/cloudflare": resolve(rootDir, "packages/cloudflare/src/index.ts"),
  "@schematics/alchemy": resolve(rootDir, "packages/alchemy/src/index.ts"),
  "@schematics/core": resolve(rootDir, "packages/core/src/index.ts"),
  // Subpath entry must precede the bare entry — alias matching is prefix-based.
  "@schematics/git-artifacts/node": resolve(rootDir, "packages/git-artifacts/src/node.ts"),
  "@schematics/git-artifacts": resolve(rootDir, "packages/git-artifacts/src/index.ts"),
  "@schematics/examples": resolve(rootDir, "examples/registry/src/index.ts"),
  "@schematics/example-survey": resolve(rootDir, "examples/survey/src/index.ts"),
  "@schematics/example-workflow": resolve(rootDir, "examples/workflow/src/index.ts"),
  "@schematics/example-ui": resolve(rootDir, "examples/shared/src/index.tsx"),
  "@schematics/onboarded-config": resolve(rootDir, "examples/onboarded/src/index.ts"),
  "@schematics/protocol": resolve(rootDir, "packages/protocol/src/index.ts"),
  "@schematics/ide": resolve(rootDir, "packages/ide/src/index.ts"),
  "@schematics/algebra": resolve(rootDir, "packages/algebra/src/index.ts"),
  "@schematics/server": resolve(rootDir, "packages/server/src/index.ts"),
};
