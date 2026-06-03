# @schematics/protocol

Shared wire contracts for Schematics chat, tools, models, health checks, and HTTP routes.
Use this package when a client and server need to agree on the OpenRouter-compatible protocol.
The `SchematicsHttpApi` contract is built with Effect's HTTP API modules and Effect Schema.
It does not depend on the agent implementation or the HTTP server implementation.
This package is the extraction target for `@schematics/protocol`.

The artifact-project RPC group exposes the agent/runtime artifact surface:

- `ListArtifactRefs`
- `GetArtifactCapabilities`
- `ReadArtifactView`
- `ApplyArtifactChange`

The primary TypeScript names are `SchematicsArtifactProjectRpcGroup`,
`SchematicsArtifactProjectService`, and `ArtifactProjectSnapshot`.

```ts
import { HttpApiClient } from "effect/unstable/httpapi";
import { SchematicsHttpApi } from "@schematics/protocol";

const client = HttpApiClient.make(SchematicsHttpApi, {
  baseUrl: "/v1",
});
```
