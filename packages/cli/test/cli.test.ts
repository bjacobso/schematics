import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeHttpClient } from "@effect/platform-node";
import { Effect, Fiber, Stream } from "effect";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import { describe, expect, it, layer } from "@effect/vitest";
import {
  createLocalFilesystemArtifactProjectClient,
  createEmbeddedSchematicsCli,
  createSchematicsCli,
  loadSchematicsProjectConfig,
  readSourceFilesFromDirectory,
  runSchematicsCli,
  serveSchematicsProject,
  validateProjectDirectory,
} from "../src";
import {
  SchematicsArtifactProjectRpcGroup,
  type SchematicsArtifactProjectService,
  type ArtifactProjectSnapshot,
} from "@schematics/protocol";
import { makeNodeGitRepoBackend } from "@schematics/git-artifacts/node";
import { defineArtifactProjectClientContract } from "../../protocol/test/artifact-project-client-contract";

const testDir = dirname(fileURLToPath(import.meta.url));
const fixtureConfigPath = resolve(testDir, "fixtures/workspace.config.ts");
const fixtureProjectConfigPath = resolve(testDir, "fixtures/project.config.ts");

describe("schematics-cli", () => {
  it("loads a consumer TypeScript project config", async () => {
    const workspace = await loadSchematicsProjectConfig(fixtureConfigPath);

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
    const workspace = await loadSchematicsProjectConfig(fixtureProjectConfigPath);

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
    const directory = await mkdtemp(join(tmpdir(), "schematics-cli-"));

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
    const workspace = await loadSchematicsProjectConfig(fixtureConfigPath);

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
      const result = await runSchematicsCli([
        "validate",
        "--schema",
        fixtureConfigPath,
        "--dir",
        directory,
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("Schematics validation failed.");
      expect(result.stdout).toContain("error workflows/onboarding.json:1:32");
      expect(result.stdout).toContain("[cross-file] Unknown action: missing");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("lets consumers ship a schema-specific CLI without requiring --schema", async () => {
    const directory = await createFixtureWorkspace();
    const workspace = await loadSchematicsProjectConfig(fixtureConfigPath);
    const cli = createSchematicsCli({ name: "workflow-fixture", project: workspace });

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
    const workspace = await loadSchematicsProjectConfig(fixtureConfigPath);
    const cli = createEmbeddedSchematicsCli({ name: "workflow-fixture", project: workspace });

    const result = await cli.run(["validate", "--schema", fixtureConfigPath]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("does not accept --schema");
  });

  it("defaults embedded CLIs to local serve", async () => {
    const directory = await createFixtureWorkspace();
    const workspace = await loadSchematicsProjectConfig(fixtureConfigPath);
    const cli = createEmbeddedSchematicsCli({ name: "workflow-fixture", project: workspace });

    try {
      const result = await cli.run([directory]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(`Starting local Schematics UI for ${directory}.`);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("accepts web as a serve alias for embedded CLIs", async () => {
    const directory = await createFixtureWorkspace();
    const staticDir = await mkdtemp(join(tmpdir(), "schematics-cli-static-"));
    const workspace = await loadSchematicsProjectConfig(fixtureConfigPath);
    const cli = createEmbeddedSchematicsCli({ name: "workflow-fixture", project: workspace });

    try {
      const result = await cli.run(["web", "--dir", directory, "--static-dir", staticDir]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(`Starting local Schematics UI for ${directory}.`);
    } finally {
      await rm(directory, { recursive: true, force: true });
      await rm(staticDir, { recursive: true, force: true });
    }
  });

  it("accepts ide as a minimal consumer IDE command", async () => {
    const directory = await createFixtureWorkspace();

    try {
      const result = await runSchematicsCli([
        "ide",
        "--schema",
        fixtureConfigPath,
        "--dir",
        directory,
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(`Starting local Schematics IDE for ${directory}.`);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("serves static UI files beside the workspace RPC server", async () => {
    const directory = await createFixtureWorkspace();
    const staticDir = await mkdtemp(join(tmpdir(), "schematics-cli-static-"));
    const workspace = await loadSchematicsProjectConfig(fixtureConfigPath);

    try {
      await writeFile(join(staticDir, "index.html"), "<main>Schematics</main>");
      const server = await serveSchematicsProject({
        project: workspace,
        directory,
        port: 0,
        staticDir,
      });

      try {
        const response = await fetch(`http://localhost:${server.port}/`);
        expect(response.status).toBe(200);
        expect(await response.text()).toContain("Schematics");
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
      const result = await runSchematicsCli(["--schema", fixtureConfigPath, directory]);

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain("Schematics validation failed.");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);

  it("prints JSON diagnostics for local agents", async () => {
    const directory = await createFixtureWorkspace();

    try {
      const result = await runSchematicsCli([
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
      const routes = await runSchematicsCli([
        "routes",
        "--schema",
        fixtureConfigPath,
        "--dir",
        directory,
      ]);
      const schema = await runSchematicsCli([
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
              loadSchematicsProjectConfig(fixtureConfigPath),
            );
            const server = yield* Effect.acquireRelease(
              Effect.promise(() =>
                serveSchematicsProject({ project: workspace, directory, port: 0 }),
              ),
              (server) => Effect.promise(() => server.close()),
            );

            const rpcClient = yield* RpcClient.make(SchematicsArtifactProjectRpcGroup).pipe(
              Effect.provide(
                RpcClient.layerProtocolHttp({
                  url: `http://localhost:${server.port}/v1/artifact-project/rpc`,
                }),
              ),
              Effect.provide(RpcSerialization.layerNdjson),
            );
            const capabilities = yield* rpcClient.GetCapabilities(undefined);
            const snapshot = yield* rpcClient.GetSnapshot(undefined);
            const watchEvents = yield* rpcClient
              .WatchArtifactProject(undefined)
              .pipe(Stream.take(2), Stream.runCollect, Effect.timeout("2 seconds"));
            const validationSummary = yield* rpcClient.ReadArtifactView({
              ref: { _tag: "Project" },
              view: "validationSummary",
            });

            expect(capabilities).toMatchObject({
              mode: "local-filesystem",
              agent: { enabled: false },
            });
            expect(snapshot.files.map((file) => file.path)).toEqual([
              "actions/email.json",
              "workflows/onboarding.json",
            ]);
            expect(validationSummary.value).toMatchObject({ errorCount: 1 });
            expect(Array.from(watchEvents).map((event) => event.type)).toEqual([
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
    const workspace = await loadSchematicsProjectConfig(fixtureConfigPath);
    const client = createLocalFilesystemArtifactProjectClient({
      project: workspace,
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
        files: expect.arrayContaining([expect.objectContaining({ path: "actions/email.json" })]),
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

  it("local filesystem workspace client exposes git history when served inside a repo", async () => {
    const directory = await createFixtureWorkspace();
    const workspace = await loadSchematicsProjectConfig(fixtureConfigPath);
    const backend = makeNodeGitRepoBackend({ dir: directory });

    try {
      await Effect.runPromise(backend.init);
      await Effect.runPromise(
        backend
          .stage("actions/email.json", Buffer.from('{"id":"email","label":"Email"}\n'))
          .pipe(
            Effect.andThen(
              backend.stage(
                "workflows/onboarding.json",
                Buffer.from('{"id":"onboarding","actionIds":["email","missing"]}\n'),
              ),
            ),
          ),
      );
      await Effect.runPromise(
        backend.commit("Seed workspace\n\nActor: system", {
          name: "Schematics",
          email: "schematics@localhost",
          timestamp: 1_777_777_777,
        }),
      );

      const client = createLocalFilesystemArtifactProjectClient({
        project: workspace,
        directory,
        debounceMs: 5,
      });

      try {
        const history = await Effect.runPromise(client.getHistory);
        expect(history.source).toBe("git");
        expect(history.entries).toHaveLength(1);
        expect(history.entries[0]).toMatchObject({
          kind: "git-commit",
          subject: "Seed workspace",
          trailers: { actor: "system" },
          author: { name: "Schematics" },
          changes: expect.arrayContaining([
            expect.objectContaining({
              path: "actions/email.json",
              status: "added",
              beforeContent: null,
              afterContent: '{"id":"email","label":"Email"}\n',
            }),
            expect.objectContaining({
              path: "workflows/onboarding.json",
              status: "added",
              beforeContent: null,
            }),
          ]),
        });
      } finally {
        await Effect.runPromise(client.close);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("local filesystem workspace client commits agent provenance trailers", async () => {
    const directory = await createFixtureWorkspace();
    const workspace = await loadSchematicsProjectConfig(fixtureConfigPath);
    const backend = makeNodeGitRepoBackend({ dir: directory });

    try {
      await Effect.runPromise(backend.init);
      await Effect.runPromise(
        backend
          .stage("actions/email.json", Buffer.from('{"id":"email","label":"Email"}\n'))
          .pipe(
            Effect.andThen(
              backend.stage(
                "workflows/onboarding.json",
                Buffer.from('{"id":"onboarding","actionIds":["email","missing"]}\n'),
              ),
            ),
          ),
      );
      await Effect.runPromise(
        backend.commit("Seed workspace\n\nActor: system", {
          name: "Schematics",
          email: "schematics@localhost",
          timestamp: 1_777_777_777,
        }),
      );

      const client = createLocalFilesystemArtifactProjectClient({
        project: workspace,
        directory,
        debounceMs: 5,
      });

      try {
        await Effect.runPromise(
          client.applyChange({
            type: "writeFile",
            path: "workflows/onboarding.json",
            content: '{"id":"onboarding","actionIds":["email"]}\n',
            provenance: {
              actor: "agent",
              turnId: "turn-test",
              toolCallId: "tool-test",
            },
          }),
        );

        const history = await Effect.runPromise(client.getHistory);
        expect(history.entries[0]).toMatchObject({
          subject: "Write workflows/onboarding.json",
          trailers: {
            actor: "agent",
            turnId: "turn-test",
            toolCallId: "tool-test",
          },
          author: { name: "Schematics Agent", email: "agent@schematics.local" },
        });
        expect(history.entries[0]?.message).toContain("Actor: agent");
        expect(history.entries[0]?.message).toContain("Turn-Id: turn-test");
        expect(history.entries[0]?.message).toContain("Tool-Call-Id: tool-test");

        const blame = execFileSync(
          "git",
          ["-C", directory, "blame", "--line-porcelain", "workflows/onboarding.json"],
          { encoding: "utf8" },
        );
        expect(blame).toContain("author Schematics Agent");
        expect(blame).toContain("author-mail <agent@schematics.local>");
      } finally {
        await Effect.runPromise(client.close);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("local filesystem workspace client persists edits without committing when history is off", async () => {
    const directory = await createFixtureWorkspace();
    const workspace = await loadSchematicsProjectConfig(fixtureConfigPath);
    const backend = makeNodeGitRepoBackend({ dir: directory });

    try {
      // A real git repo exists, but history is opted out: writes must land on
      // disk while git stays untouched.
      await Effect.runPromise(backend.init);

      const client = createLocalFilesystemArtifactProjectClient({
        project: workspace,
        directory,
        debounceMs: 5,
        history: false,
      });

      try {
        const capabilities = await Effect.runPromise(client.getCapabilities);
        expect(capabilities.features.history).toBe(false);

        await Effect.runPromise(
          client.applyChange({
            type: "writeFile",
            path: "actions/email.json",
            content: '{"id":"email","label":"Updated"}\n',
          }),
        );

        // The edit persists to the real file.
        await expect(readFile(join(directory, "actions/email.json"), "utf8")).resolves.toContain(
          "Updated",
        );

        // No git history surface, and zero commits were created.
        await expect(Effect.runPromise(client.getHistory)).rejects.toThrow();
        const log = execFileSync("git", ["-C", directory, "rev-list", "--all", "--count"], {
          encoding: "utf8",
        }).trim();
        expect(log).toBe("0");
      } finally {
        await Effect.runPromise(client.close);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("local filesystem workspace client serves configured artifact project views", async () => {
    const directory = await createFixtureWorkspace();
    const workspace = await loadSchematicsProjectConfig(fixtureConfigPath);
    const client = createLocalFilesystemArtifactProjectClient({
      project: workspace,
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
      ...(await loadSchematicsProjectConfig(fixtureConfigPath)),
      include: ["**/*.json", "**/*.pdf"],
    };
    const client = createLocalFilesystemArtifactProjectClient({
      project: workspace,
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
    const workspace = await loadSchematicsProjectConfig(fixtureConfigPath);
    const client = createLocalFilesystemArtifactProjectClient({
      project: workspace,
      directory,
      debounceMs: 5,
    });

    try {
      const invalidSnapshot = waitForSnapshot(client, (snapshot) =>
        snapshot.files.some(
          (file) => file.path === "actions/email.json" && file.content === '{"id":',
        ),
      );
      await writeFile(join(directory, "actions/email.json"), '{"id":');

      await invalidSnapshot;
      const validationSummary = await Effect.runPromise(
        client.readArtifactView({ ref: { _tag: "Project" }, view: "validationSummary" }),
      );
      const diagnostics = await Effect.runPromise(
        client.readArtifactView({ ref: { _tag: "Project" }, view: "diagnostics" }),
      );
      expect(validationSummary.value).toMatchObject({ valid: false });
      expect(diagnostics.value).toEqual(
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
    const workspace = await loadSchematicsProjectConfig(fixtureConfigPath);
    const client = createLocalFilesystemArtifactProjectClient({
      project: workspace,
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
        name: "SchematicsArtifactProjectError",
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
        name: "SchematicsArtifactProjectError",
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

defineArtifactProjectClientContract({
  name: "local filesystem workspace client",
  createSubject: Effect.gen(function* () {
    const directory = yield* Effect.promise(() => createFixtureWorkspace());
    const workspace = yield* Effect.promise(() => loadSchematicsProjectConfig(fixtureConfigPath));
    const client = createLocalFilesystemArtifactProjectClient({
      project: workspace,
      directory,
      debounceMs: 5,
    });

    return {
      artifactProject: client,
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
  client: Pick<SchematicsArtifactProjectService, "watchArtifactProject">,
  predicate: (snapshot: ArtifactProjectSnapshot) => boolean,
): Promise<ArtifactProjectSnapshot> {
  return new Promise((resolvePromise, reject) => {
    let fiber: Fiber.Fiber<void, unknown> | null = null;
    const timeout = setTimeout(() => {
      if (fiber) Effect.runFork(Fiber.interrupt(fiber));
      reject(new Error("Timed out waiting for workspace snapshot."));
    }, 2_000);
    fiber = Effect.runFork(
      client.watchArtifactProject.pipe(
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
  const directory = await mkdtemp(join(tmpdir(), "schematics-cli-"));
  await mkdir(join(directory, "actions"), { recursive: true });
  await mkdir(join(directory, "workflows"), { recursive: true });
  await writeFile(join(directory, "actions/email.json"), '{"id":"email","label":"Email"}\n');
  await writeFile(
    join(directory, "workflows/onboarding.json"),
    '{"id":"onboarding","actionIds":["email","missing"]}\n',
  );
  return directory;
}
