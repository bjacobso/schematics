import type { DeployConnection } from "@schematics/protocol";
import { Effect } from "effect";

/**
 * Server-side store for secret-free deploy connection records. Credentials live
 * in DeploySecretStore; this store only remembers where and how to reconnect.
 */
export interface DeployConnectionStore {
  readonly list: Effect.Effect<readonly DeployConnection[], unknown>;
  readonly get: (connectionId: string) => Effect.Effect<DeployConnection | null, unknown>;
  readonly save: (connection: DeployConnection) => Effect.Effect<void, unknown>;
  readonly delete: (connectionId: string) => Effect.Effect<void, unknown>;
}

export function makeMemoryDeployConnectionStore(
  initial: readonly DeployConnection[] = [],
): DeployConnectionStore {
  const connections = new Map(initial.map((connection) => [connection.id, connection]));
  return {
    list: Effect.sync(() => [...connections.values()]),
    get: (id) => Effect.sync(() => connections.get(id) ?? null),
    save: (connection) => Effect.sync(() => void connections.set(connection.id, connection)),
    delete: (id) => Effect.sync(() => void connections.delete(id)),
  };
}
