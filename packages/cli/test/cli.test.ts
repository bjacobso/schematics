import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { NodeHttpClient } from "@effect/platform-node";
import { Effect, Fiber, Stream } from "effect";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import { describe, expect, it, layer } from "@effect/vitest";
import {
  createLocalFilesystemWorkspaceBranchManager,
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
  SchemaIdeWorkspaceBranchRpcGroup,
  SchemaIdeWorkspaceRpcGroup,
  type SchemaIdeWorkspaceService,
  type WorkspaceSnapshot,
} from "@schema-ide/protocol";
import { defineWorkspaceClientContract } from "../../protocol/test/workspace-client-contract";

const testDir = dirname(fileURLToPath(import.meta.url));
const fixtureConfigPath = resolve(testDir, "fixtures/workspace.config.ts");
const execFileAsync = promisify(execFile);

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

  it("reads binary workspace sidecars as base64 content", async () => {
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

  it("accepts web as a serve alias for embedded CLIs", async () => {
    const directory = await createFixtureWorkspace();
    const staticDir = await mkdtemp(join(tmpdir(), "schema-ide-cli-static-"));
    const workspace = await loadSchemaIdeWorkspaceConfig(fixtureConfigPath);
    const cli = createEmbeddedSchemaIdeCli({ name: "workflow-fixture", workspace });

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
    const workspace = await loadSchemaIdeWorkspaceConfig(fixtureConfigPath);

    try {
      await writeFile(join(staticDir, "index.html"), "<main>Schema IDE</main>");
      const server = await serveSchemaIdeWorkspace({ workspace, directory, port: 0, staticDir });

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

          const rpcClient = yield* RpcClient.make(SchemaIdeWorkspaceRpcGroup).pipe(
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
            .WatchWorkspace(undefined)
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
        }),
      ),
    );

    it.effect("serves local workspace branch RPC and branch-scoped workspace RPC", () =>
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

          const branchClient = yield* RpcClient.make(SchemaIdeWorkspaceBranchRpcGroup).pipe(
            Effect.provide(
              RpcClient.layerProtocolHttp({
                url: `http://localhost:${server.port}/v1/workspace/branch-rpc`,
              }),
            ),
            Effect.provide(RpcSerialization.layerNdjson),
          );
          const created = yield* branchClient.CreateBranch({ name: "rpc-draft" });
          const branchWorkspace = yield* RpcClient.make(SchemaIdeWorkspaceRpcGroup).pipe(
            Effect.provide(
              RpcClient.layerProtocolHttp({
                url: `http://localhost:${server.port}/v1/workspace/branches/${created.branch.id}/rpc`,
              }),
            ),
            Effect.provide(RpcSerialization.layerNdjson),
          );

          yield* branchWorkspace.ApplyWorkspaceChange({
            type: "writeFile",
            path: "actions/email.json",
            content: '{"id":"email","label":"Branch RPC edit"}\n',
          });
          const comparison = yield* branchClient.CompareBranch({
            sourceBranchId: created.branch.id,
          });
          const merge = yield* branchClient.MergeBranch({
            sourceBranchId: created.branch.id,
          });

          expect(comparison).toMatchObject({
            sourceBranchId: created.branch.id,
            targetBranchId: "main",
            mergeable: true,
          });
          expect(merge.status).toBe("merged");
          yield* Effect.promise(() =>
            expect(readFile(join(directory, "actions/email.json"), "utf8")).resolves.toContain(
              "Branch RPC edit",
            ),
          );
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
  });

  it("local filesystem workspace client keeps binary sidecars as bytes on disk", async () => {
    const directory = await createFixtureWorkspace();
    const workspace = {
      ...(await loadSchemaIdeWorkspaceConfig(fixtureConfigPath)),
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

  it("managed filesystem branches isolate draft edits and merge back to the root", async () => {
    const directory = await createFixtureWorkspace();
    const workspace = await loadSchemaIdeWorkspaceConfig(fixtureConfigPath);
    const manager = createLocalFilesystemWorkspaceBranchManager({ workspace, directory });

    try {
      const created = await manager.createBranch({ name: "draft" });
      const draftClient = manager.getWorkspaceClient(created.branch.id);
      await Effect.runPromise(
        draftClient.applyChange({
          type: "writeFile",
          path: "actions/email.json",
          content: '{"id":"email","label":"Draft edit"}\n',
        }),
      );
      await Effect.runPromise(draftClient.close);

      await expect(readFile(join(directory, "actions/email.json"), "utf8")).resolves.not.toContain(
        "Draft edit",
      );
      const comparison = await manager.compareBranch({ sourceBranchId: created.branch.id });
      expect(comparison).toMatchObject({
        sourceBranchId: created.branch.id,
        targetBranchId: "main",
        mergeable: true,
        files: [expect.objectContaining({ type: "modified", path: "actions/email.json" })],
      });

      const merge = await manager.mergeBranch({ sourceBranchId: created.branch.id });
      expect(merge.status).toBe("merged");
      await expect(readFile(join(directory, "actions/email.json"), "utf8")).resolves.toContain(
        "Draft edit",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("managed filesystem branch merges report conflicts without overwriting root files", async () => {
    const directory = await createFixtureWorkspace();
    const workspace = await loadSchemaIdeWorkspaceConfig(fixtureConfigPath);
    const manager = createLocalFilesystemWorkspaceBranchManager({ workspace, directory });

    try {
      const created = await manager.createBranch({ name: "draft" });
      await writeFile(
        join(directory, "actions/email.json"),
        '{"id":"email","label":"Main edit"}\n',
      );
      const draftClient = manager.getWorkspaceClient(created.branch.id);
      await Effect.runPromise(
        draftClient.applyChange({
          type: "writeFile",
          path: "actions/email.json",
          content: '{"id":"email","label":"Draft edit"}\n',
        }),
      );
      await Effect.runPromise(draftClient.close);

      const merge = await manager.mergeBranch({ sourceBranchId: created.branch.id });

      expect(merge.status).toBe("conflicts");
      if (merge.status === "conflicts") {
        expect(merge.conflicts).toEqual([
          expect.objectContaining({
            type: "content",
            path: "actions/email.json",
          }),
        ]);
      }
      await expect(readFile(join(directory, "actions/email.json"), "utf8")).resolves.toContain(
        "Main edit",
      );

      const forcedMerge = await manager.mergeBranch({
        sourceBranchId: created.branch.id,
        strategy: "source-wins",
      });

      expect(forcedMerge.status).toBe("merged");
      await expect(readFile(join(directory, "actions/email.json"), "utf8")).resolves.toContain(
        "Draft edit",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("uses a git worktree for draft branches when explicitly enabled and available", async () => {
    await assertGitAvailable();
    const directory = await createFixtureWorkspace();
    const worktreeDirectory = await mkdtemp(join(tmpdir(), "schema-ide-worktrees-"));
    const workspace = await loadSchemaIdeWorkspaceConfig(fixtureConfigPath);

    try {
      await execFileAsync("git", ["-C", directory, "init"]);
      await execFileAsync("git", ["-C", directory, "config", "user.email", "test@example.com"]);
      await execFileAsync("git", ["-C", directory, "config", "user.name", "Schema IDE Test"]);
      await execFileAsync("git", ["-C", directory, "add", "."]);
      await execFileAsync("git", ["-C", directory, "commit", "-m", "initial"]);

      const manager = createLocalFilesystemWorkspaceBranchManager({
        workspace,
        directory,
        gitWorktrees: true,
        gitWorktreeDirectory: worktreeDirectory,
      });
      const created = await manager.createBranch({ name: "git-draft" });
      const metadata = JSON.parse(
        await readFile(join(directory, ".schema-ide", "branches.json"), "utf8"),
      ) as {
        readonly branches: readonly { readonly id: string; readonly worktreePath?: string }[];
      };
      const branchRecord = metadata.branches.find((branch) => branch.id === created.branch.id);

      expect(branchRecord?.worktreePath).toContain(worktreeDirectory);

      const draftClient = manager.getWorkspaceClient(created.branch.id);
      await Effect.runPromise(
        draftClient.applyChange({
          type: "writeFile",
          path: "actions/email.json",
          content: '{"id":"email","label":"Git worktree edit"}\n',
        }),
      );
      await Effect.runPromise(draftClient.close);

      await expect(readFile(join(directory, "actions/email.json"), "utf8")).resolves.not.toContain(
        "Git worktree edit",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
      await rm(worktreeDirectory, { recursive: true, force: true });
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
    const workspace = await loadSchemaIdeWorkspaceConfig(fixtureConfigPath);
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
        name: "SchemaIdeWorkspaceError",
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
        name: "SchemaIdeWorkspaceError",
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
    const workspace = yield* Effect.promise(() => loadSchemaIdeWorkspaceConfig(fixtureConfigPath));
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
  client: Pick<SchemaIdeWorkspaceService, "watchWorkspace">,
  predicate: (snapshot: WorkspaceSnapshot) => boolean,
): Promise<WorkspaceSnapshot> {
  return new Promise((resolvePromise, reject) => {
    let fiber: Fiber.Fiber<void, unknown> | null = null;
    const timeout = setTimeout(() => {
      if (fiber) Effect.runFork(Fiber.interrupt(fiber));
      reject(new Error("Timed out waiting for workspace snapshot."));
    }, 2_000);
    fiber = Effect.runFork(
      client.watchWorkspace.pipe(
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

async function assertGitAvailable(): Promise<void> {
  try {
    await execFileAsync("git", ["--version"]);
  } catch {
    expect.skip("git is not available in this environment");
  }
}
