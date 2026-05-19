import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  createEmbeddedSchemaIdeCli,
  createSchemaIdeCli,
  loadSchemaIdeWorkspaceConfig,
  readSourceFilesFromDirectory,
  runSchemaIdeCli,
  validateWorkspaceDirectory,
} from "../src";

const testDir = dirname(fileURLToPath(import.meta.url));
const fixtureConfigPath = resolve(testDir, "fixtures/workspace.config.ts");

describe("schema-ide-cli", () => {
  it("loads a consumer TypeScript workspace config", async () => {
    const workspace = await loadSchemaIdeWorkspaceConfig(fixtureConfigPath);

    expect(workspace.id).toBe("workflow-fixture");
    expect(workspace.schema.reflect().map((schema) => schema.id)).toEqual(["Actions", "Workflows"]);
  });

  it("reads local source files using include and exclude patterns", async () => {
    const directory = await createFixtureWorkspace();

    try {
      await writeFile(join(directory, "README.md"), "# ignored\n");
      await mkdir(join(directory, "node_modules"), { recursive: true });
      await writeFile(join(directory, "node_modules/ignored.json"), "{}\n");

      const files = await readSourceFilesFromDirectory({ directory });

      expect(files.map((file) => file.path)).toEqual([
        "actions/email.json",
        "workflows/onboarding.json",
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("validates a local directory through the same core reflection path", async () => {
    const directory = await createFixtureWorkspace();
    const workspace = await loadSchemaIdeWorkspaceConfig(fixtureConfigPath);

    try {
      const reflection = await validateWorkspaceDirectory({ workspace, directory });

      expect(reflection.validationSummary).toMatchObject({
        valid: false,
        errorCount: 1,
      });
      expect(reflection.diagnostics[0]).toMatchObject({
        path: "workflows/onboarding.json",
        source: "cross-file",
        message: "Unknown action: missing",
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("prints human diagnostics and exits non-zero when validation fails", async () => {
    const directory = await createFixtureWorkspace();

    try {
      const result = await runSchemaIdeCli([
        "validate",
        "--schema",
        fixtureConfigPath,
        "--dir",
        directory,
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("Schema IDE validation failed.");
      expect(result.stdout).toContain("error workflows/onboarding.json:1:20");
      expect(result.stdout).toContain("[cross-file] Unknown action: missing");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("lets consumers ship a schema-specific CLI without requiring --schema", async () => {
    const directory = await createFixtureWorkspace();
    const workspace = await loadSchemaIdeWorkspaceConfig(fixtureConfigPath);
    const cli = createSchemaIdeCli({ name: "workflow-fixture", workspace });

    try {
      const help = await cli.run(["help"]);
      const validation = await cli.run(["validate", "--dir", directory, "--json"]);
      const body = JSON.parse(validation.stdout) as {
        readonly summary: { readonly valid: boolean; readonly errorCount: number };
        readonly diagnostics: readonly { readonly message: string }[];
      };

      expect(help.exitCode).toBe(0);
      expect(help.stdout).toContain("Usage: workflow-fixture <command> [--schema <path>]");
      expect(validation.exitCode).toBe(1);
      expect(body.summary).toMatchObject({ valid: false, errorCount: 1 });
      expect(body.diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
        "Unknown action: missing",
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("lets static bundled CLIs reject runtime schema overrides", async () => {
    const workspace = await loadSchemaIdeWorkspaceConfig(fixtureConfigPath);
    const cli = createEmbeddedSchemaIdeCli({ name: "workflow-fixture", workspace });

    const result = await cli.run(["validate", "--schema", fixtureConfigPath]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("does not accept --schema");
  });

  it("defaults to validate when the command is omitted", async () => {
    const directory = await createFixtureWorkspace();

    try {
      const result = await runSchemaIdeCli(["--schema", fixtureConfigPath, directory]);

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain("Schema IDE validation failed.");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("prints JSON diagnostics for local agents", async () => {
    const directory = await createFixtureWorkspace();

    try {
      const result = await runSchemaIdeCli([
        "validate",
        "--schema",
        fixtureConfigPath,
        "--dir",
        directory,
        "--json",
      ]);
      const body = JSON.parse(result.stdout) as {
        readonly summary: { readonly valid: boolean; readonly errorCount: number };
        readonly diagnostics: readonly { readonly message: string }[];
      };

      expect(result.exitCode).toBe(1);
      expect(body.summary).toMatchObject({ valid: false, errorCount: 1 });
      expect(body.diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
        "Unknown action: missing",
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("prints routes and reflected schemas", async () => {
    const directory = await createFixtureWorkspace();

    try {
      const routes = await runSchemaIdeCli([
        "routes",
        "--schema",
        fixtureConfigPath,
        "--dir",
        directory,
      ]);
      const schema = await runSchemaIdeCli([
        "schema",
        "--schema",
        fixtureConfigPath,
        "--dir",
        directory,
        "--schema-id",
        "Workflows",
        "--json",
      ]);
      const reflected = JSON.parse(schema.stdout) as {
        readonly id: string;
        readonly jsonSchema: unknown;
      };

      expect(routes.exitCode).toBe(0);
      expect(routes.stdout).toContain("actions/email.json\tActions\tjson");
      expect(routes.stdout).toContain("workflows/onboarding.json\tWorkflows\tjson");
      expect(schema.exitCode).toBe(0);
      expect(reflected.id).toBe("Workflows");
      expect(reflected.jsonSchema).toMatchObject({ type: "object" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

async function createFixtureWorkspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "schema-ide-cli-"));
  await mkdir(join(directory, "actions"), { recursive: true });
  await mkdir(join(directory, "workflows"), { recursive: true });
  await writeFile(join(directory, "actions/email.json"), '{"id":"email","label":"Email"}\n');
  await writeFile(
    join(directory, "workflows/onboarding.json"),
    '{"id":"onboarding","actionIds":["email","missing"]}\n',
  );
  return directory;
}
