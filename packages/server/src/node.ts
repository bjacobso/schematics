import { NodeFileSystem, NodeHttpPlatform, NodeHttpServer, NodePath } from "@effect/platform-node";
import { Effect, Exit, Layer, Scope } from "effect";
import { Etag, HttpRouter } from "effect/unstable/http";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { makeSchemaIdeAppLayer, type SchemaIdeAppOptions } from "./app";

export interface SchemaIdeNodeServerOptions extends SchemaIdeAppOptions {
  readonly port?: number | undefined;
}

export interface SchemaIdeNodeServerHandle {
  readonly port: number;
  readonly close: () => Promise<void>;
}

export function makeSchemaIdeHttpHandler(options: SchemaIdeNodeServerOptions): {
  readonly handler: (request: Request) => Promise<Response>;
  readonly dispose: () => Promise<void>;
} {
  return HttpRouter.toWebHandler(
    makeSchemaIdeAppLayer(options).pipe(
      Layer.provide([Etag.layer, NodeFileSystem.layer, NodeHttpPlatform.layer, NodePath.layer]),
    ),
  );
}

export async function runSchemaIdeHttpServer(
  options: SchemaIdeNodeServerOptions,
): Promise<SchemaIdeNodeServerHandle> {
  const requestedPort = options.port ?? 4317;
  const nodeServer = createServer();
  const scope = Effect.runSync(Scope.make());
  const serverLayer = HttpRouter.serve(makeSchemaIdeAppLayer(options), {
    disableListenLog: true,
  }).pipe(
    Layer.provide(
      NodeHttpServer.layer(() => nodeServer, {
        port: requestedPort,
      }),
    ),
  );

  try {
    await Effect.runPromise(Layer.buildWithScope(serverLayer, scope));
  } catch (error) {
    await Effect.runPromise(Scope.close(scope, Exit.fail(error)));
    throw error;
  }

  return {
    port: resolveServerPort(nodeServer.address(), requestedPort),
    close: () => Effect.runPromise(Scope.close(scope, Exit.void)),
  };
}

function resolveServerPort(address: string | AddressInfo | null, fallbackPort: number): number {
  return typeof address === "object" && address !== null ? address.port : fallbackPort;
}
