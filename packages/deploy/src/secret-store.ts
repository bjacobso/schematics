import { Effect } from "effect";

/**
 * Server-side store for connection secrets. A token is referenced by connection
 * id and never returned to the client or written to the file tree. The deploy
 * service depends only on this interface, so a real consumer can back it with a
 * worker Secret/KV binding instead of memory.
 */
export interface DeploySecretStore {
  readonly put: (connectionId: string, token: string) => Effect.Effect<void>;
  readonly get: (connectionId: string) => Effect.Effect<string | null>;
  readonly delete: (connectionId: string) => Effect.Effect<void>;
}

/** Trivial in-memory secret store. Replace with a worker Secret/KV binding in production. */
export function makeMemoryDeploySecretStore(): DeploySecretStore {
  const secrets = new Map<string, string>();
  return {
    put: (id, token) => Effect.sync(() => void secrets.set(id, token)),
    get: (id) => Effect.sync(() => secrets.get(id) ?? null),
    delete: (id) => Effect.sync(() => void secrets.delete(id)),
  };
}
