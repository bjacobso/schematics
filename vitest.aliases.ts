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
  "@schematics/git-artifacts/clock": resolve(rootDir, "packages/git-artifacts/src/clock.ts"),
  "@schematics/git-artifacts": resolve(rootDir, "packages/git-artifacts/src/index.ts"),
  "@schematics/ingest": resolve(rootDir, "packages/ingest/src/index.ts"),
  "@schematics/examples": resolve(rootDir, "examples/registry/src/index.ts"),
  "@schematics/example-toy": resolve(rootDir, "examples/toy/src/index.ts"),
  "@schematics/example-salesforce": resolve(rootDir, "examples/salesforce/src/index.ts"),
  "@schematics/example-pagerduty": resolve(rootDir, "examples/pagerduty/src/index.ts"),
  "@schematics/example-okta": resolve(rootDir, "examples/okta/src/index.ts"),
  "@schematics/example-github": resolve(rootDir, "examples/github/src/index.ts"),
  // Subpath entries must precede the bare entry — alias matching is prefix-based.
  "@schematics/deploy/node": resolve(rootDir, "packages/deploy/src/node.ts"),
  "@schematics/deploy": resolve(rootDir, "packages/deploy/src/index.ts"),
  "@schematics/provider/cli": resolve(rootDir, "packages/provider/src/cli.ts"),
  "@schematics/provider": resolve(rootDir, "packages/provider/src/index.ts"),
  "@schematics/example-catalog/cli": resolve(rootDir, "examples/catalog/src/cli.ts"),
  "@schematics/example-catalog/deploy": resolve(rootDir, "examples/catalog/src/deploy-cli.ts"),
  "@schematics/example-catalog/workspace-config": resolve(
    rootDir,
    "examples/catalog/src/workspace-config.ts",
  ),
  "@schematics/example-catalog": resolve(rootDir, "examples/catalog/src/index.ts"),
  "@schematics/protocol": resolve(rootDir, "packages/protocol/src/index.ts"),
  "@schematics/ide": resolve(rootDir, "packages/ide/src/index.ts"),
  "@schematics/algebra": resolve(rootDir, "packages/algebra/src/index.ts"),
  "@schematics/server": resolve(rootDir, "packages/server/src/index.ts"),
};
