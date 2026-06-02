# @schema-ide/cloudflare

Cloudflare deployment primitives for Schema IDE hosted artifact projects.

This package exports the Durable Object runtime and small Alchemy v2 helpers so
apps can deploy their own hosted artifact project worker while keeping the local
filesystem and in-memory browser strategies available.

## Runtime entrypoint

```ts
import { handleHostedWorkspaceRequest, SchemaIdeWorkspaceObject } from "@schema-ide/cloudflare";

export { SchemaIdeWorkspaceObject };

export default {
  async fetch(request: Request, env: Env) {
    const hostedWorkspaceResponse = await handleHostedWorkspaceRequest(request, env);
    if (hostedWorkspaceResponse) return hostedWorkspaceResponse;

    return appFetch(request, env);
  },
};
```

The default binding name is `SCHEMA_IDE_WORKSPACES`, and the default public API
is:

- `POST /v1/workspaces`
- `GET /v1/workspaces/:workspaceId`
- `POST /v1/workspaces/:workspaceId/rpc`

## Alchemy v2

```ts
import { makeSchemaIdeApiWorker } from "@schema-ide/cloudflare/alchemy";

export default makeSchemaIdeApiWorker("Api", {
  main: new URL("./worker.ts", import.meta.url).pathname,
  env: {
    SCHEMA_IDE_TITLE: "My Schema IDE",
  },
});
```

Use `makeSchemaIdeWorkspaceNamespace` if you need to compose the Durable Object
binding into a custom worker resource by hand.
