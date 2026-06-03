# @schema-ide/config-deploy

A provider-agnostic **config-as-code engine** — a Terraform/Alchemy-style
`pull → plan → apply → destroy` loop over schema-validated artifact files. The
engine knows nothing about any specific API; you teach it one entity kind by
implementing a `ConfigProvider`.

## Mental model

Four primitives (the same ones Terraform/Alchemy are built on):

1. **Provider** — a stable entity kind with `list / read / create / update / delete`.
2. **State** — a lockfile mapping a human **slug** ↔ the opaque **remote id**
   (`ConfigStateStore`; in-memory or `config.lock.json`).
3. **Plan** — diff the desired files against live remote → `create | update | delete | no-op`.
4. **Apply** — execute the plan in dependency order, writing state back.

Files are the desired state (an `ArtifactStore` + a `ConfigCodec` for the format);
identity is a slug in the file, resolved to a remote id through the lockfile.

## The provider contract

```ts
interface ConfigProvider<Props> {
  kind: string;
  schema: Schema.Schema<Props>;            // Props ⇄ wire (the codec handles text)
  keyOf: (props: Props) => string;          // slug from a desired file
  suggestKey: (entity: RemoteEntity<Props>) => string; // slug for a newly-discovered remote entity
  applyKey: (props: Props, key: string) => Props;       // pin a slug into props before writing
  pathFor: (key: string) => string;         // working-tree path, e.g. `widgets/<slug>.json`
  route: string;                             // glob matching this kind's files
  dependsOn?: (props: Props) => readonly { kind: string; key: string }[];

  listSummaries: Effect<readonly RemoteSummary[], ProviderError>;   // cheap list (skeleton/seed)
  list: Effect<readonly RemoteEntity<Props>[], ProviderError>;      // full list (for diffing)
  read: (remoteId: string) => Effect<RemoteEntity<Props> | null, ProviderError>;
  create: (props: Props, ctx: ApplyContext) => Effect<RemoteEntity<Props>, ProviderError>;
  update: (remoteId: string, props: Props, ctx: ApplyContext) => Effect<RemoteEntity<Props>, ProviderError>;
  delete: (remoteId: string) => Effect<void, ProviderError>;
}
```

`RemoteEntity<Props> = { remoteId, props }`. `ApplyContext.resolveRemoteId(kind, key)`
maps a slug to its remote id during apply (reflecting in-progress + lockfile state)
— use it to resolve cross-entity references.

## Toy example, end to end

Build a `Widget` resource against a pretend in-memory API, then run the loop.

```ts
import { createMemoryArtifactStore } from "@schema-ide/artifacts";
import {
  jsonCodec,
  makeConfigDeploy,
  renderPlan,
  ProviderError,
  type ConfigProvider,
  type RemoteEntity,
} from "@schema-ide/config-deploy";
import { Effect, Schema } from "effect";

// 1. the desired-state shape (a slug `name` + fields)
const Widget = Schema.Struct({ name: Schema.String, color: Schema.String, size: Schema.Number });
type Widget = typeof Widget.Type;

// 2. a provider over a pretend remote API (an in-memory Map keyed by opaque id)
function widgetProvider(): ConfigProvider<Widget> {
  const remote = new Map<string, Widget>([["wgt_seed", { name: "gizmo", color: "red", size: 1 }]]);
  let counter = 0;
  const entity = (remoteId: string, props: Widget): RemoteEntity<Widget> => ({ remoteId, props });

  return {
    kind: "Widget",
    schema: Widget,
    keyOf: (w) => w.name,
    suggestKey: (e) => e.props.name,
    applyKey: (w, key) => ({ ...w, name: key }),
    pathFor: (key) => `widgets/${key}.json`,
    route: "widgets/*.json",

    listSummaries: Effect.sync(() =>
      [...remote.entries()].map(([id, w]) => ({ remoteId: id, suggestedKey: w.name })),
    ),
    list: Effect.sync(() => [...remote.entries()].map(([id, w]) => entity(id, w))),
    read: (id) => Effect.sync(() => (remote.has(id) ? entity(id, remote.get(id)!) : null)),
    create: (w) =>
      Effect.sync(() => {
        counter += 1;
        const id = `wgt_${counter}`;
        remote.set(id, w);
        return entity(id, w);
      }),
    update: (id, w) =>
      Effect.sync(() => {
        remote.set(id, w);
        return entity(id, w);
      }),
    delete: (id) => Effect.sync(() => void remote.delete(id)),
  };
}

// 3. wire the engine: working tree (memory) + JSON files + the provider
const store = createMemoryArtifactStore();
const deploy = makeConfigDeploy({ store, providers: [widgetProvider()], codec: jsonCodec });

const program = Effect.gen(function* () {
  // pull: remote → files (writes widgets/gizmo.json + seeds the lockfile)
  yield* deploy.pull;

  // edit a pulled file: recolor the widget
  const ref = { _tag: "ProjectFile" as const, path: "widgets/gizmo.json" };
  yield* store.write(ref, jsonCodec.stringify({ name: "gizmo", color: "blue", size: 1 }));

  // add a brand-new widget (a file with a fresh slug → a create)
  yield* store.create(
    { _tag: "ProjectFile", path: "widgets/sprocket.json" },
    jsonCodec.stringify({ name: "sprocket", color: "green", size: 3 }),
  );

  // plan: diff files vs live
  const plan = yield* deploy.plan;
  console.log(renderPlan(plan));
  //  Plan: 1 to create, 1 to update, 0 to destroy, 0 unchanged.
  //    + Widget  sprocket  (widgets/sprocket.json)
  //    ~ Widget  gizmo     (widgets/gizmo.json)
  //        ~ color: "red" -> "blue"

  // apply: execute (gizmo updated, sprocket created in the remote Map)
  const result = yield* deploy.apply(plan);
  return result;
});

await Effect.runPromise(program);
```

That's the whole loop: `pull` hydrated `widgets/gizmo.json` from the remote and
recorded `gizmo → wgt_seed` in the lockfile; `plan` produced a schema-value diff;
`apply` called `update("wgt_seed", …)` and `create(…)` in dependency order.

## Cross-entity references

When one resource references another by slug (e.g. a policy that lists forms),
declare `dependsOn` so dependencies apply first, and resolve the slug to a remote
id inside `create`/`update` via `ctx.resolveRemoteId(otherKind, slug)`. On the
read side, build a resolver from a lockfile snapshot (`ConfigStateStore.read`).
See `@schema-ide/onboarded-config` for a worked multi-entity implementation.

## State (lockfile)

```ts
import { artifactConfigStateStore, memoryConfigStateStore } from "@schema-ide/config-deploy";

makeConfigDeploy({ store, providers, codec: jsonCodec, state: memoryConfigStateStore() });        // ephemeral
makeConfigDeploy({ store, providers, codec: jsonCodec, state: artifactConfigStateStore(store) }); // config.lock.json
```

State is optional; it defaults to an in-memory store. The lockfile is the only
place a human slug is tied to its opaque remote id, so a persistent store
(`config.lock.json`) is what makes the loop reproducible across runs.

## Lazy / streaming sync

`makeHydratingArtifactStore({ providers, codec, state })` is an `ArtifactStore`
that lays out a **skeleton** from `listSummaries` (pending entries) and fetches
content on first `read` (de-duplicated). Its `sync` stream emits `listed` /
`hydrated` events and `watch` emits `created → hydrated`, so an editor fills in
over time instead of blocking on a full pull.

## Testing

`makeFakeProvider({ kind, schema, keyOf, applyKey, seed })` is an in-memory,
call-recording provider for exercising the engine without a real API — see this
package's tests for the lifecycle spec (fixed-point pull, create/update/delete,
optimistic-concurrency abort, dependency ordering).
