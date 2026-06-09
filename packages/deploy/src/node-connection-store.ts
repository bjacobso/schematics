import type { DeployConnection } from "@schematics/protocol";
import { Effect } from "effect";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { DeployConnectionStore } from "./connection-store";

interface ConnectionStoreFile {
  readonly connections?: readonly DeployConnection[];
}

export interface FsDeployConnectionStoreOptions {
  readonly filePath?: string | undefined;
}

/**
 * Filesystem-backed secret-free connection store. Defaults to
 * `<directory>/.schematics/connections.json`.
 */
export function createFsDeployConnectionStore(
  directory: string,
  options: FsDeployConnectionStoreOptions = {},
): DeployConnectionStore {
  const filePath = options.filePath ?? join(directory, ".schematics", "connections.json");

  const readConnections = Effect.tryPromise({
    try: async () => {
      try {
        const json = await readFile(filePath, "utf8");
        const parsed = JSON.parse(json) as ConnectionStoreFile;
        return Array.isArray(parsed.connections) ? [...parsed.connections] : [];
      } catch (error) {
        if (isNotFound(error)) return [];
        throw error;
      }
    },
    catch: (error) => error,
  });

  const writeConnections = (connections: readonly DeployConnection[]) =>
    Effect.tryPromise({
      try: async () => {
        await mkdir(dirname(filePath), { recursive: true });
        await writeFile(filePath, `${JSON.stringify({ connections }, null, 2)}\n`, "utf8");
      },
      catch: (error) => error,
    });

  return {
    list: readConnections,
    get: (id) =>
      Effect.map(
        readConnections,
        (connections) => connections.find((connection) => connection.id === id) ?? null,
      ),
    save: (connection) =>
      Effect.gen(function* () {
        const connections = yield* readConnections;
        const index = connections.findIndex((candidate) => candidate.id === connection.id);
        const next =
          index < 0
            ? [...connections, connection]
            : connections.map((candidate, i) => (i === index ? connection : candidate));
        yield* writeConnections(next);
      }),
    delete: (id) =>
      Effect.gen(function* () {
        const connections = yield* readConnections;
        yield* writeConnections(connections.filter((connection) => connection.id !== id));
      }),
  };
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
