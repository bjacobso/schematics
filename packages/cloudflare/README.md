# @schematics/cloudflare

Cloudflare deployment primitives for Schematics hosted artifact projects.

This package exports the Durable Object runtime and small Alchemy v2 helpers so
apps can deploy their own hosted artifact project worker while keeping the local
filesystem and in-memory browser strategies available.

## Runtime entrypoint

```ts
import { handleHostedWorkspaceRequest, SchematicsWorkspaceObject } from "@schematics/cloudflare";

export { SchematicsWorkspaceObject };

export default {
  async fetch(request: Request, env: Env) {
    const hostedWorkspaceResponse = await handleHostedWorkspaceRequest(request, env);
    if (hostedWorkspaceResponse) return hostedWorkspaceResponse;

    return appFetch(request, env);
  },
};
```

The default binding name is `SCHEMATICS_WORKSPACES`, and the default public API
is:

- `POST /v1/workspaces`
- `GET /v1/workspaces/:workspaceId`
- `POST /v1/workspaces/:workspaceId/rpc`

## Alchemy v2

```ts
import { makeSchematicsApiWorker } from "@schematics/cloudflare/alchemy";

export default makeSchematicsApiWorker("Api", {
  main: new URL("./worker.ts", import.meta.url).pathname,
  env: {
    SCHEMATICS_TITLE: "My Schematics",
  },
});
```

Use `makeSchematicsWorkspaceNamespace` if you need to compose the Durable Object
binding into a custom worker resource by hand.
