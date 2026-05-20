import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeHttpClient } from "@effect/platform-node";
import { Effect } from "effect";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import { describe, expect, it, layer } from "@effect/vitest";
import {
  createLocalFilesystemWorkspaceClient,
  createEmbeddedSchemaIdeCli,
  createSchemaIdeCli,
  loadSchemaIdeWorkspaceConfig,
  readSourceFilesFromDirectory,
  runSchemaIdeCli,
  serveSchemaIdeWorkspace,
  validateWorkspaceDirectory,
} from "../src";
import {
  SchemaIdeWorkspaceRpcGroup,
  type WorkspaceEvent,
  type WorkspaceSnapshot,
} from "@schema-ide/protocol";
import { defineWorkspaceClientContract } from "../../protocol/test/workspace-client-contract";

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

  it("defaults embedded CLIs to local serve", async () => {
    const directory = await createFixtureWorkspace();
    const workspace = await loadSchemaIdeWorkspaceConfig(fixtureConfigPath);
    const cli = createEmbeddedSchemaIdeCli({ name: "workflow-fixture", workspace });

    try {
      const result = await cli.run([directory]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(`Starting local Schema IDE UI for ${directory}.`);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
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

  layer(NodeHttpClient.layerUndici)("workspace RPC HTTP client", (it) => {
    it.effect("serves workspace capabilities and snapshots over the local HTTP server", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const directory = yield* Effect.acquireRelease(
            Effect.promise(() => createFixtureWorkspace()),
            (directory) => Effect.promise(() => rm(directory, { recursive: true, force: true })),
          );
          const workspace = yield* Effect.promise(() =>
            loadSchemaIdeWorkspaceConfig(fixtureConfigPath),
          );
          const server = yield* Effect.acquireRelease(
            Effect.promise(() => serveSchemaIdeWorkspace({ workspace, directory, port: 0 })),
            (server) => Effect.promise(() => server.close()),
          );

          const capabilitiesResponse = yield* Effect.promise(() =>
            fetch(`http://localhost:${server.port}/v1/workspace/capabilities`),
          );
          const snapshotResponse = yield* Effect.promise(() =>
            fetch(`http://localhost:${server.port}/v1/workspace/snapshot`),
          );
          const capabilities = yield* Effect.promise(() => capabilitiesResponse.json());
          const snapshot = yield* Effect.promise(
            () => snapshotResponse.json() as Promise<WorkspaceSnapshot>,
          );
          const rpcClient = yield* RpcClient.make(SchemaIdeWorkspaceRpcGroup).pipe(
            Effect.provide(
              RpcClient.layerProtocolHttp({
                url: `http://localhost:${server.port}/v1/workspace/rpc`,
              }),
            ),
            Effect.provide(RpcSerialization.layerJson),
          );
          const rpcCapabilities = yield* rpcClient.GetCapabilities(undefined);

          expect(capabilitiesResponse.status).toBe(200);
          expect(capabilities).toMatchObject({
            mode: "local-filesystem",
            agent: { enabled: false },
          });
          expect(rpcCapabilities).toMatchObject({
            mode: "local-filesystem",
            agent: { enabled: false },
          });
          expect(snapshotResponse.status).toBe(200);
          expect(snapshot.files.map((file) => file.path)).toEqual([
            "actions/email.json",
            "workflows/onboarding.json",
          ]);
          expect(snapshot.reflection.validationSummary.errorCount).toBe(1);
        }),
      ),
    );
  });

  it("local filesystem workspace client writes to disk and watches external edits", async () => {
    const directory = await createFixtureWorkspace();
    const workspace = await loadSchemaIdeWorkspaceConfig(fixtureConfigPath);
    const client = createLocalFilesystemWorkspaceClient({
      workspace,
      directory,
      debounceMs: 5,
    });

    try {
      await client.applyChange({
        type: "writeFile",
        path: "actions/email.json",
        content: '{"id":"email","label":"Updated by UI"}\n',
      });
      await expect(readFile(join(directory, "actions/email.json"), "utf8")).resolves.toContain(
        "Updated by UI",
      );

      const externalSnapshot = waitForSnapshot(client, (snapshot) =>
        snapshot.files.some(
          (file) => file.path === "actions/email.json" && file.content.includes("External edit"),
        ),
      );
      await writeFile(
        join(directory, "actions/email.json"),
        '{"id":"email","label":"External edit"}\n',
      );

      await expect(externalSnapshot).resolves.toMatchObject({
        reflection: {
          files: expect.arrayContaining([
            expect.objectContaining({ path: "actions/email.json" }),
          ]),
        },
      });

      const deletedSnapshot = waitForSnapshot(client, (snapshot) =>
        snapshot.files.every((file) => file.path !== "workflows/onboarding.json"),
      );
      await rm(join(directory, "workflows/onboarding.json"));
      await expect(deletedSnapshot).resolves.toMatchObject({
        files: expect.not.arrayContaining([
          expect.objectContaining({ path: "workflows/onboarding.json" }),
        ]),
      });
    } finally {
      client.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("local filesystem workspace client reports invalid external JSON as diagnostics", async () => {
    const directory = await createFixtureWorkspace();
    const workspace = await loadSchemaIdeWorkspaceConfig(fixtureConfigPath);
    const client = createLocalFilesystemWorkspaceClient({
      workspace,
      directory,
      debounceMs: 5,
    });

    try {
      const invalidSnapshot = waitForSnapshot(client, (snapshot) =>
        snapshot.reflection.diagnostics.some(
          (diagnostic) => diagnostic.source === "json-parse" && diagnostic.path === "actions/email.json",
        ),
      );
      await writeFile(join(directory, "actions/email.json"), '{"id":');

      const snapshot = await invalidSnapshot;
      expect(snapshot.reflection.validationSummary.valid).toBe(false);
      expect(snapshot.reflection.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: "actions/email.json", source: "json-parse" }),
        ]),
      );
    } finally {
      client.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("local filesystem workspace client rejects unsafe paths", async () => {
    const directory = await createFixtureWorkspace();
    const workspace = await loadSchemaIdeWorkspaceConfig(fixtureConfigPath);
    const client = createLocalFilesystemWorkspaceClient({
      workspace,
      directory,
      debounceMs: 5,
    });

    try {
      await expect(
        client.applyChange({
          type: "writeFile",
          path: "../outside.json",
          content: "{}\n",
        }),
      ).rejects.toMatchObject({
        name: "SchemaIdeWorkspaceError",
        code: "unsafe-path",
      });
    } finally {
      client.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});

defineWorkspaceClientContract({
  name: "local filesystem workspace client",
  createSubject: async () => {
    const directory = await createFixtureWorkspace();
    const workspace = await loadSchemaIdeWorkspaceConfig(fixtureConfigPath);
    const client = createLocalFilesystemWorkspaceClient({
      workspace,
      directory,
      debounceMs: 5,
    });

    return {
      client,
      cleanup: async () => {
        client.close();
        await rm(directory, { recursive: true, force: true });
      },
    };
  },
  existingPath: "actions/email.json",
  updatedContent: '{"id":"email","label":"Updated by contract"}\n',
  replacedContent: '{"id":"email","label":"Replaced by contract"}\n',
  invalidContent: '{"id":',
});

function waitForSnapshot(
  client: { readonly watchWorkspace: (onEvent: (event: WorkspaceEvent) => void) => { unsubscribe: () => void } },
  predicate: (snapshot: WorkspaceSnapshot) => boolean,
): Promise<WorkspaceSnapshot> {
  return new Promise((resolvePromise, reject) => {
    let subscription: { unsubscribe: () => void } | null = null;
    const timeout = setTimeout(() => {
      subscription?.unsubscribe();
      reject(new Error("Timed out waiting for workspace snapshot."));
    }, 2_000);
    subscription = client.watchWorkspace((event) => {
      if (event.type !== "snapshot" || !predicate(event.snapshot)) return;
      clearTimeout(timeout);
      subscription?.unsubscribe();
      resolvePromise(event.snapshot);
    });
  });
}

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
