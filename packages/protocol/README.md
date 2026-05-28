# @schema-ide/protocol

Shared wire contracts for Schema IDE chat, tools, models, health checks, and HTTP routes.
Use this package when a client and server need to agree on the OpenRouter-compatible protocol.
The `SchemaIdeHttpApi` contract is built with Effect's HTTP API modules and Effect Schema.
It does not depend on the agent implementation or the HTTP server implementation.
This package is the extraction target for `@schema-ide/protocol`.

The workspace RPC group also exposes artifact migration methods:

- `ListArtifactRefs`
- `GetArtifactCapabilities`
- `ReadArtifactView`
- `ApplyArtifactChange`

These are currently compatibility projections over `WorkspaceSnapshot` and
`WorkspaceChangeRequest`, so clients can begin using artifact refs and views
while existing workspace routes remain available.

```ts
import { HttpApiClient } from "effect/unstable/httpapi";
import { SchemaIdeHttpApi } from "@schema-ide/protocol";

const client = HttpApiClient.make(SchemaIdeHttpApi, {
  baseUrl: "/v1",
});
```
