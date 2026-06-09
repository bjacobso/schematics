# Provider DSL Providers

`examples/toy` is the smallest full provider package. It keeps the schema
exports that schema-only consumers need, but the runnable provider surface comes
from two DSL calls:

1. Define each top-level object type with `defineResource(...)`.
2. Compose the resource list with `defineProvider(...)`.

The provider derives the artifact project, workspace schema, relation
diagnostics, mock transport, reconciler, deploy service, and CLI-ready project
config. For token-backed examples, `defineTokenConnection(...)` supplies the
standard Connect UI shape while each provider keeps its own environment list.

Minimal file layout:

```text
src/schema.ts            relation-annotated Effect schemas
src/resources.ts         defineResource(...) per top-level entity
src/connection.ts        defineTokenConnection(...)
src/seed.ts              remote records for the derived mock
src/provider.ts          defineProvider(...)
src/workspace-config.ts  defineProviderProject(provider)
src/cli.ts               createProviderCli(provider)
```

Fixture projects can re-export the generated project config:

```ts
export { ToyConfigProject as default } from "@schematics/example-toy/workspace-config";
```

Use a separate `projectId` when the provider id and artifact project id should
differ:

```ts
export const toyProvider = defineProvider({
  id: "toy",
  projectId: "toy-yaml",
  resources: toyResources,
  connection: TOY_CONNECTION_OPTIONS,
  mockSeed: validToySeed,
});
```
