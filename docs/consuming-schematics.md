# Consuming Schematics

How an external team consumes Schematics to author their own domain-specific
config-as-code project — today with a git submodule, tomorrow with npm — without
forking the framework or vendoring its dev harness.

The first-party `@schematics/example-catalog` package (`examples/catalog`) is
the living reference for everything below.

## Mental model: what you consume vs. what you build

Schematics is the set of `@schematics/*` packages. You **consume** them — you
never copy them into your tree. Your repo owns only your domain:

| You build (your repo)                                   | You consume (`@schematics/*`)                                 |
| ------------------------------------------------------- | ------------------------------------------------------------- |
| `src/domain/*` — Effect-Schema mirrors of your API DTOs | `core`, `artifacts`, `algebra` — runtime, routing, relations  |
| `src/config/*` — config-file schemas + DTO⇄config maps  | `alchemy` — `pull/plan/apply/destroy` engine                  |
| `src/mock/*` — a mock API for offline development       | `cli` — the `schematics` CLI + `createEmbeddedSchematicsCli`  |
| your artifact project + deploy wiring + CLI entry       | `server`, `git-artifacts`, `protocol` — serve / history / RPC |
| (optional) your frontend, built from `@schematics/ide`  | `ide` — the `<Schematics />` React surface                    |

The package layout under `examples/catalog/src` is the recommended shape to
mirror.

## Linking the framework — submodule phase (today)

The `@schematics/*` packages are unpublished (private `0.0.0`). Until they hit a
registry, the supported consumer pattern is **vendor-as-submodule + pnpm
`workspace:*` link**.

### 1. Add the framework as a submodule

```bash
git submodule add <schematics-repo-url> .context/schematics
```

Pin the framework by submodule SHA. Upgrading = bump the SHA, then re-sync the
catalog (step 3).

### 2. Link only the transitive closure

In your `pnpm-workspace.yaml`, link the packages your project actually imports —
**not** `packages/*`:

```yaml
packages:
  - "."
  - ".context/schematics/packages/algebra"
  - ".context/schematics/packages/artifacts"
  - ".context/schematics/packages/alchemy"
  - ".context/schematics/packages/core"
  - ".context/schematics/packages/protocol"
  - ".context/schematics/packages/server"
  - ".context/schematics/packages/git-artifacts"
  - ".context/schematics/packages/cli"
  # add only if you ship a frontend (see "Shipping a frontend"):
  # - ".context/schematics/packages/ide"
```

Then depend on them with `workspace:*` in your `package.json`:

```json
{
  "dependencies": {
    "@schematics/alchemy": "workspace:*",
    "@schematics/artifacts": "workspace:*",
    "@schematics/cli": "workspace:*",
    "@schematics/core": "workspace:*"
  }
}
```

> **Do not glob `packages/*`.** It drags in `cloudflare` and the example/`ide`
> wiring, which loop back through the framework's example registry onto your own
> package name. Enumerate the closure explicitly.

### 3. Replicate the pnpm catalog

The framework's packages reference pinned versions via pnpm `catalog:`. Copy the
`catalog:` block from `.context/schematics/pnpm-workspace.yaml` into your own
`pnpm-workspace.yaml` so the linked packages resolve. Re-sync this block whenever
you bump the submodule.

### 4. Extend the framework's tsconfig

```jsonc
// tsconfig.json
{ "extends": "./.context/schematics/tsconfig.base.json" /* ... */ }
```

### 5. Alias `@schematics/*` to source for tests

Add a `vitest.aliases.ts` that points each consumed package at the submodule's
`src` (template off `.context/schematics/vitest.aliases.ts`, rewriting the base
path to `.context/schematics/...`), and **scope vitest to your own tests** so it
doesn't sweep the submodule's ~1100 test files:

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";
import { schematicsAliases } from "./vitest.aliases";

export default defineConfig({
  test: { alias: schematicsAliases, include: ["test/**/*.test.ts"] },
});
```

## npm phase (future)

No work is required now — but follow these rules so the eventual migration is a
mechanical swap, not a refactor:

- **Import only by package name** (`@schematics/core`), never by relative path
  into `.context/schematics`.
- **Keep the closure explicit** and never depend on the framework's repo layout
  (no `apps/playground`, no `../../packages/...`).

When the packages publish, the migration is:

1. Remove the submodule, the `.context/schematics` workspace entries, the catalog
   replication, and `vitest.aliases.ts`.
2. Swap each `"@schematics/*": "workspace:*"` → `"^x.y.z"` in `package.json`.
3. `pnpm install`.

That's it — your source imports don't change.

## Building a binary

Your CLI binary is a single self-contained executable: your `defineSchematicsProject`
config wrapped by `createEmbeddedSchematicsCli` and compiled to a
[Node SEA](https://nodejs.org/api/single-executable-applications.html). The
framework ships the builder as the `schematics-build-binary` bin (from
`@schematics/cli`), so you don't vendor a build script.

The binary needs **no web UI** — `validate`, `routes`, `schema`, `inspect`,
`plan`, and `apply` are all UI-less. Build it with:

```bash
pnpm exec schematics-build-binary \
  --project ./src/workspace-config.ts \
  --project-export MyProject \
  --name my-config
```

- `--project` points at the module exporting your `defineSchematicsProject(...)`
  result; `--project-export` names the export (omit for a `default` export).
- Output: a runnable bundle at `dist/bundle/<name>.cjs` and a SEA binary at
  `dist/sea/<name>`. Add `--bundle-only` to stop at the bundle (e.g. on Node
  < 25.5, which cannot run `--build-sea`).
- Source-link note: the builder bundles `@schematics/cli` by package name. If you
  haven't built the framework's `dist`, either build it once
  (`pnpm -C .context/schematics build`) or pass
  `--cli-entry .context/schematics/packages/cli/src/index.ts` to bundle from
  source.

`schematics-build-binary --help` lists every flag.

## Building a deploy CLI

If your domain package also needs `pull → plan → apply → destroy` against a
remote API, add a deploy CLI using the generic harness from
`@schematics/deploy/node`. The harness owns the common command flow and
filesystem target; your package supplies the API adapter and `ConfigDeploy`
factory.

See [deploy-cli.md](./deploy-cli.md) for the full implementer and consumer
workflow, including command semantics, flags, `--dir` layout, and the catalog
reference implementation.

## Shipping a frontend (optional)

If you want a UI, **build your own app from `@schematics/ide`** — do not vendor
the framework's `apps/playground`. The playground is a multi-mode dev harness;
the reusable surface is the `@schematics/ide` React package.

A minimal consumer frontend is a Vite + React 19 app whose entry is roughly:

```tsx
import { Schematics, defineSchematicsProduct } from "@schematics/ide";
import { createLocalSchematicsChatAdapter } from "@schematics/agent";
import { MyWorkspaceSchema } from "./schemas";
import { myPreviews } from "./previews";

const MyIde = defineSchematicsProduct({
  id: "my-domain",
  title: "My Domain IDE",
  schema: MyWorkspaceSchema,
  previews: myPreviews,
  assistant: { systemPrompt: "Help users edit my domain files." },
}).Component;

export default function App() {
  return <MyIde chat={createLocalSchematicsChatAdapter()} />;
}
```

You can also drop to `<Schematics schema={…} previews={…} chat={…} />` directly.
For a server-backed workspace, build the client with
`createRpcArtifactProjectClient(baseUrl, "/v1/artifact-project/rpc")` instead of
the in-memory `createSchematicsArtifactClient`. All of these are exported from
`@schematics/ide`; see `apps/playground/PlaygroundApp.tsx` as an example to
_read_ (its mode-switching, git, and example-picker logic is harness-only, not
something to copy).

**Closure note:** add `ide` to your linked closure, and keep node-only packages
(`cli`, `server`, `alchemy`, `git-artifacts/node`) out of the browser bundle.
The IDE's runtime closure (`core`, `agent`, `artifacts`, `protocol`) is
browser-safe; React is the only real peer.

Two ways to ship that frontend:

1. **Embed it in the binary.** Build the app to a dir, then pass it to the
   builder:

   ```bash
   pnpm exec schematics-build-binary \
     --project ./src/workspace-config.ts --project-export MyProject \
     --name my-config --assets-dir ./web/dist
   ```

   The binary's `serve`/`web` command then serves your UI at `/` (the same path
   as `--static-dir` / `SCHEMATICS_STATIC_DIR`).

2. **Deploy it independently.** Host the static SPA anywhere and point it at a
   running `@schematics/server` over `/v1`. See the local-filesystem and hosted
   topologies in [architecture-deployment-modes.md](./architecture-deployment-modes.md).

## Reference

- [architecture-deployment-modes.md](./architecture-deployment-modes.md) — the
  three runtime modes (local serve / memory / hosted) and where data lives.
- [plan-consumer-extensions.md](./plan-consumer-extensions.md) — the
  `defineSchematicsProduct` extension API.
- `examples/catalog` — the reference consumer.
