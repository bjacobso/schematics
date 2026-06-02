import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeHttpClient } from "@effect/platform-node";
import { Effect, Fiber, Stream } from "effect";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import { describe, expect, it, layer } from "@effect/vitest";
import {
  createLocalFilesystemWorkspaceClient,
  createEmbeddedSchemaIdeCli,
  createSchemaIdeCli,
  loadSchemaIdeProjectConfig,
  readSourceFilesFromDirectory,
  runSchemaIdeCli,
  serveSchemaIdeProject,
  validateProjectDirectory,
} from "../src";
import {
  SchemaIdeArtifactProjectRpcGroup,
  type SchemaIdeArtifactProjectService,
  type ArtifactProjectStateSnapshot,
} from "@schema-ide/protocol";
import { defineWorkspaceClientContract } from "../../protocol/test/workspace-client-contract";

const testDir = dirname(fileURLToPath(import.meta.url));
const fixtureConfigPath = resolve(testDir, "fixtures/workspace.config.ts");
const fixtureProjectConfigPath = resolve(testDir, "fixtures/project.config.ts");

describe("schema-ide-cli", () => {
  it("loads a consumer TypeScript project config", async () => {
    const workspace = await loadSchemaIdeProjectConfig(fixtureConfigPath);

    expect(workspace.id).toBe("workflow-fixture");
    expect(workspace.schema.reflect().map((schema) => schema.id)).toEqual(["Actions", "Workflows"]);
    expect(
      workspace.artifactProject?.capabilities({ _tag: "Project" }).map((cap) => cap.view),
    ).toEqual(
      expect.arrayContaining([
        "decodedWorkspace",
        "diagnostics",
        "validationSummary",
        "routeMatches",
        "reflection",
      ]),
    );
    expect(
      workspace.artifactProject
        ?.capabilities({
          _tag: "ProjectFile",
          projectId: workspace.id,
          path: "actions/email.json",
        })
        .map((capability) => capability.routeId),
    ).toEqual(expect.arrayContaining(["Actions"]));
  });

  it("loads a consumer TypeScript artifact project config", async () => {
    const workspace = await loadSchemaIdeProjectConfig(fixtureProjectConfigPath);

    expect(workspace.id).toBe("workflow-project-fixture");
    expect(workspace.schema.reflect().map((schema) => schema.id)).toEqual(["Actions", "Workflows"]);
    expect(workspace.artifactProject?.name).toBe("workflow-project-fixture");
    expect(
      workspace.artifactProject
        ?.capabilities({
          _tag: "ProjectFile",
          projectId: workspace.id,
          path: "actions/email.json",
        })
        .map((capability) => capability.id),
    ).toEqual(["Actions.decodedValue"]);
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

  it("reads binary artifact sidecars as base64 content", async () => {
    const directory = await mkdtemp(join(tmpdir(), "schema-ide-cli-"));

    try {
      await mkdir(join(directory, "documents"), { recursive: true });
      const bytes = Buffer.from("%PDF-1.7\n%%EOF\n");
      await writeFile(join(directory, "documents", "sample.pdf"), bytes);

      const files = await readSourceFilesFromDirectory({
        directory,
        include: ["**/*.pdf"],
      });

      expect(files).toEqual([
        {
          path: "documents/sample.pdf",
          content: bytes.toString("base64"),
        },
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("validates a local directory through the same core reflection path", async () => {
    const directory = await createFixtureWorkspace();
    const workspace = await loadSchemaIdeProjectConfig(fixtureConfigPath);

    try {
      const reflection = await validateProjectDirectory({
        project: workspace,
        directory,
      });

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
    const workspace = await loadSchemaIdeProjectConfig(fixtureConfigPath);
    const cli = createSchemaIdeCli({ name: "workflow-fixture", project: workspace });

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
    const workspace = await loadSchemaIdeProjectConfig(fixtureConfigPath);
    const cli = createEmbeddedSchemaIdeCli({ name: "workflow-fixture", project: workspace });

    const result = await cli.run(["validate", "--schema", fixtureConfigPath]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("does not accept --schema");
  });

  it("defaults embedded CLIs to local serve", async () => {
    const directory = await createFixtureWorkspace();
    const workspace = await loadSchemaIdeProjectConfig(fixtureConfigPath);
    const cli = createEmbeddedSchemaIdeCli({ name: "workflow-fixture", project: workspace });

    try {
      const result = await cli.run([directory]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(`Starting local Schema IDE UI for ${directory}.`);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("accepts web as a serve alias for embedded CLIs", async () => {
    const directory = await createFixtureWorkspace();
    const staticDir = await mkdtemp(join(tmpdir(), "schema-ide-cli-static-"));
    const workspace = await loadSchemaIdeProjectConfig(fixtureConfigPath);
    const cli = createEmbeddedSchemaIdeCli({ name: "workflow-fixture", project: workspace });

    try {
      const result = await cli.run(["web", "--dir", directory, "--static-dir", staticDir]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(`Starting local Schema IDE UI for ${directory}.`);
    } finally {
      await rm(directory, { recursive: true, force: true });
      await rm(staticDir, { recursive: true, force: true });
    }
  });

  it("serves static UI files beside the workspace RPC server", async () => {
    const directory = await createFixtureWorkspace();
    const staticDir = await mkdtemp(join(tmpdir(), "schema-ide-cli-static-"));
    const workspace = await loadSchemaIdeProjectConfig(fixtureConfigPath);

    try {
      await writeFile(join(staticDir, "index.html"), "<main>Schema IDE</main>");
      const server = await serveSchemaIdeProject({
        project: workspace,
        directory,
        port: 0,
        staticDir,
      });

      try {
        const response = await fetch(`http://localhost:${server.port}/`);
        expect(response.status).toBe(200);
        expect(await response.text()).toContain("Schema IDE");
      } finally {
        await server.close();
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
      await rm(staticDir, { recursive: true, force: true });
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
  }, 30_000);

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
  }, 30_000);

  layer(NodeHttpClient.layerUndici)("workspace RPC HTTP client", (it) => {
    it.effect(
      "serves workspace capabilities and snapshots over the local HTTP server",
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const directory = yield* Effect.acquireRelease(
              Effect.promise(() => createFixtureWorkspace()),
              (directory) => Effect.promise(() => rm(directory, { recursive: true, force: true })),
            );
            const workspace = yield* Effect.promise(() =>
              loadSchemaIdeProjectConfig(fixtureConfigPath),
            );
            const server = yield* Effect.acquireRelease(
              Effect.promise(() =>
                serveSchemaIdeProject({ project: workspace, directory, port: 0 }),
              ),
              (server) => Effect.promise(() => server.close()),
            );

            const rpcClient = yield* RpcClient.make(SchemaIdeArtifactProjectRpcGroup).pipe(
              Effect.provide(
                RpcClient.layerProtocolHttp({
                  url: `http://localhost:${server.port}/v1/workspace/rpc`,
                }),
              ),
              Effect.provide(RpcSerialization.layerNdjson),
            );
            const capabilities = yield* rpcClient.GetCapabilities(undefined);
            const snapshot = yield* rpcClient.GetSnapshot(undefined);
            const watchEvents = yield* rpcClient
              .WatchArtifactProjectState(undefined)
              .pipe(Stream.take(2), Stream.runCollect, Effect.timeout("2 seconds"));
            const artifactProjectEvents = yield* rpcClient
              .WatchArtifactProject(undefined)
              .pipe(Stream.take(2), Stream.runCollect, Effect.timeout("2 seconds"));

            expect(capabilities).toMatchObject({
              mode: "local-filesystem",
              agent: { enabled: false },
            });
            expect(snapshot.files.map((file) => file.path)).toEqual([
              "actions/email.json",
              "workflows/onboarding.json",
            ]);
            expect(snapshot.reflection.validationSummary.errorCount).toBe(1);
            expect(Array.from(watchEvents).map((event) => event.type)).toEqual([
              "capabilities",
              "snapshot",
            ]);
            expect(Array.from(artifactProjectEvents).map((event) => event.type)).toEqual([
              "capabilities",
              "snapshot",
            ]);
          }),
        ),
      30_000,
    );
  });

  it("local filesystem workspace client writes to disk and watches external edits", async () => {
    const directory = await createFixtureWorkspace();
    const workspace = await loadSchemaIdeProjectConfig(fixtureConfigPath);
    const client = createLocalFilesystemWorkspaceClient({
      workspace,
      directory,
      debounceMs: 5,
    });

    try {
      await Effect.runPromise(
        client.applyChange({
          type: "writeFile",
          path: "actions/email.json",
          content: '{"id":"email","label":"Updated by UI"}\n',
        }),
      );
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
          files: expect.arrayContaining([expect.objectContaining({ path: "actions/email.json" })]),
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
      await Effect.runPromise(client.close);
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);

  it("local filesystem workspace client serves configured artifact project views", async () => {
    const directory = await createFixtureWorkspace();
    const workspace = await loadSchemaIdeProjectConfig(fixtureConfigPath);
    const client = createLocalFilesystemWorkspaceClient({
      workspace,
      directory,
      debounceMs: 5,
    });
    const ref = { _tag: "ProjectFile" as const, path: "actions/email.json" };

    try {
      const capabilities = await Effect.runPromise(client.getArtifactCapabilities({ ref }));
      expect(capabilities.capabilities.map((capability) => capability.view)).toEqual(
        expect.arrayContaining([
          "sourceText",
          "parsedValue",
          "jsonSchema",
          "diagnostics",
          "decodedValue",
        ]),
      );

      await expect(
        Effect.runPromise(client.readArtifactView({ ref, view: "decodedValue" })),
      ).resolves.toMatchObject({
        value: {
          id: "email",
          label: "Email",
        },
      });
    } finally {
      await Effect.runPromise(client.close);
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("local filesystem workspace client keeps binary sidecars as bytes on disk", async () => {
    const directory = await createFixtureWorkspace();
    const workspace = {
      ...(await loadSchemaIdeProjectConfig(fixtureConfigPath)),
      include: ["**/*.json", "**/*.pdf"],
    };
    const client = createLocalFilesystemWorkspaceClient({
      workspace,
      directory,
      debounceMs: 5,
    });
    const pdfPath = join(directory, "documents", "sample.pdf");
    const originalBytes = Buffer.from("%PDF-1.7\n%%EOF\n");
    const updatedBytes = Buffer.from("%PDF-1.7\n% updated\n%%EOF\n");

    try {
      await mkdir(dirname(pdfPath), { recursive: true });
      await writeFile(pdfPath, originalBytes);

      const snapshot = await Effect.runPromise(client.getSnapshot);
      expect(snapshot.files).toEqual(
        expect.arrayContaining([
          {
            path: "documents/sample.pdf",
            content: originalBytes.toString("base64"),
          },
        ]),
      );

      await Effect.runPromise(
        client.applyChange({
          type: "writeFile",
          path: "documents/sample.pdf",
          content: updatedBytes.toString("base64"),
        }),
      );

      await expect(readFile(pdfPath)).resolves.toEqual(updatedBytes);
    } finally {
      await Effect.runPromise(client.close);
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("local filesystem workspace client reports invalid external JSON as diagnostics", async () => {
    const directory = await createFixtureWorkspace();
    const workspace = await loadSchemaIdeProjectConfig(fixtureConfigPath);
    const client = createLocalFilesystemWorkspaceClient({
      workspace,
      directory,
      debounceMs: 5,
    });

    try {
      const invalidSnapshot = waitForSnapshot(client, (snapshot) =>
        snapshot.reflection.diagnostics.some(
          (diagnostic) =>
            diagnostic.source === "json-parse" && diagnostic.path === "actions/email.json",
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
      await Effect.runPromise(client.close);
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("local filesystem workspace client rejects unsafe paths", async () => {
    const directory = await createFixtureWorkspace();
    const workspace = await loadSchemaIdeProjectConfig(fixtureConfigPath);
    const client = createLocalFilesystemWorkspaceClient({
      workspace,
      directory,
      debounceMs: 5,
    });

    try {
      await expect(
        Effect.runPromise(
          client.applyChange({
            type: "writeFile",
            path: "../outside.json",
            content: "{}\n",
          }),
        ),
      ).rejects.toMatchObject({
        name: "SchemaIdeArtifactProjectError",
        code: "unsafe-path",
      });
      await expect(
        Effect.runPromise(
          client.applyChange({
            type: "replaceFiles",
            files: [{ path: "../outside.json", content: "{}\n" }],
          }),
        ),
      ).rejects.toMatchObject({
        name: "SchemaIdeArtifactProjectError",
        code: "unsafe-path",
      });
      await expect(readFile(join(directory, "actions/email.json"), "utf8")).resolves.toContain(
        "Email",
      );
    } finally {
      await Effect.runPromise(client.close);
      await rm(directory, { recursive: true, force: true });
    }
  });
});

defineWorkspaceClientContract({
  name: "local filesystem workspace client",
  createSubject: Effect.gen(function* () {
    const directory = yield* Effect.promise(() => createFixtureWorkspace());
    const workspace = yield* Effect.promise(() => loadSchemaIdeProjectConfig(fixtureConfigPath));
    const client = createLocalFilesystemWorkspaceClient({
      workspace,
      directory,
      debounceMs: 5,
    });

    return {
      workspace: client,
      cleanup: client.close.pipe(
        Effect.andThen(Effect.promise(() => rm(directory, { recursive: true, force: true }))),
      ),
    };
  }),
  existingPath: "actions/email.json",
  updatedContent: '{"id":"email","label":"Updated by contract"}\n',
  replacedContent: '{"id":"email","label":"Replaced by contract"}\n',
  invalidContent: '{"id":',
});

function waitForSnapshot(
  client: Pick<SchemaIdeArtifactProjectService, "watchArtifactProjectState">,
  predicate: (snapshot: ArtifactProjectStateSnapshot) => boolean,
): Promise<ArtifactProjectStateSnapshot> {
  return new Promise((resolvePromise, reject) => {
    let fiber: Fiber.Fiber<void, unknown> | null = null;
    const timeout = setTimeout(() => {
      if (fiber) Effect.runFork(Fiber.interrupt(fiber));
      reject(new Error("Timed out waiting for workspace snapshot."));
    }, 2_000);
    fiber = Effect.runFork(
      client.watchArtifactProjectState.pipe(
        Stream.runForEach((event) =>
          Effect.sync(() => {
            if (event.type !== "snapshot" || !predicate(event.snapshot)) return;
            clearTimeout(timeout);
            if (fiber) Effect.runFork(Fiber.interrupt(fiber));
            resolvePromise(event.snapshot);
          }),
        ),
      ),
    );
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
