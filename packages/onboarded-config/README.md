# @schema-ide/onboarded-config

First-party Onboarded account configuration package for Schema IDE.

It models the Onboarded account config — **account, custom properties, forms,
policies, automations** — two complementary ways:

- **Config-as-code** (`pull → edit → plan → apply`) over `@schema-ide/config-deploy`,
  backed by an in-memory **mock `OnboardedApi`** so the whole lifecycle runs with
  no live backend.
- **Artifact project** for the Schema IDE's schema-routed validation/reflection of
  the on-disk YAML example (the validate/web/bundle sections below).

## Architecture

Three schema layers map between the hand-editable files and the domain API:

- `src/domain/*` — faithful Effect-Schema mirrors of the Onboarded domain DTOs
  (the API "wire" shapes: `acc_`/`pcy_`/`auto_`/uid ids, snake_case).
- `src/config/*` — config-file schemas (slug `id`s, references by slug/path, no
  server-only fields) + DTO⇄config mappers.
- `src/mock/*` — `makeMockOnboardedApi()`: seeded, call-recording, per-entity CRUD
  mirroring the internal endpoints.

`makeOnboardedConfigDeploy({ store, api })` wires five providers into the engine.
Identity uses a committed `config.lock.json` (slug ↔ remote id); cross-entity
references resolve through it — a policy lists its forms by slug (→ `formIds`
uids), and automation action params resolve `task_lineage_uid` form slugs.

### Run the config-as-code loop

The `onboarded-deploy` CLI runs the lifecycle against a directory of YAML files,
backed by the **in-memory mock `OnboardedApi` by default** — so it works with no
live backend. Build the package once, then invoke the bin:

```bash
# 1. build (emits dist/deploy-cli-bin.js and links the `onboarded-deploy` bin)
pnpm turbo run build --filter @schema-ide/onboarded-config

# 2. pull the mock account into a fresh directory (writes YAML + config.lock.json)
DIR=$(mktemp -d)
node packages/onboarded-config/dist/deploy-cli-bin.js pull --dir "$DIR"
#   Pulled 7 resource(s) … account.yaml, custom-properties/*, forms/*, policies/*, automations/*

# 3. a clean pull plans to nothing (fixed point)
node packages/onboarded-config/dist/deploy-cli-bin.js plan --dir "$DIR"
#   Plan: 0 to create, 0 to update, 0 to destroy, 7 unchanged.

# 4. edit a file, then plan again to see the diff
sed -i '' 's/^name: .*/name: Employee Handbook v2/' "$DIR/forms/employee-handbook.yaml"
node packages/onboarded-config/dist/deploy-cli-bin.js plan --dir "$DIR"
#   ~ OnboardedForm  employee-handbook  (forms/employee-handbook.yaml)
#       ~ name: "Employee Handbook" -> "Employee Handbook v2"

# 5. apply is gated; pass --auto-approve to execute (and --allow-delete to prune)
node packages/onboarded-config/dist/deploy-cli-bin.js apply --dir "$DIR" --auto-approve

# 6. tear it all down
node packages/onboarded-config/dist/deploy-cli-bin.js destroy --dir "$DIR" --auto-approve
```

Add `--json` to any command for machine-readable output (CI / agents). Once the
workspace bin is linked you can also call `onboarded-deploy …` directly (e.g.
`pnpm --dir packages/onboarded-config exec onboarded-deploy plan --dir "$DIR"`).

Programmatically:

```ts
import { makeOnboardedConfigDeploy, makeMockOnboardedApi } from "@schema-ide/onboarded-config";
import { createFsArtifactStore } from "@schema-ide/onboarded-config";
import { Effect } from "effect";

const deploy = makeOnboardedConfigDeploy({
  store: createFsArtifactStore("./account-config", { projectId: "onboarded-account-yaml" }),
  api: makeMockOnboardedApi(), // swap for a real InternalApi-backed adapter
});

await Effect.runPromise(deploy.pull);
const plan = await Effect.runPromise(deploy.plan);
await Effect.runPromise(deploy.apply(plan, { allowDelete: false }));
```

Point it at a real account by implementing the `OnboardedApi` port over the
Onboarded internal HttpApi and passing it as `api`.

## Artifact project (IDE validation)

The package is also packaged like a consumer of Schema IDE: it imports
`@schema-ide/cli`, embeds its artifact project, and can bundle the result with the
web UI.

The sample also includes
`projects/onboarded-account-yaml/artifact-project.yaml`, a serializable
artifact-project declaration for the same routes and schema-algebra views. The
sample `schema-ide.config.ts` reads that YAML as its route/config source of
truth. The TypeScript runtime can parse the same file with
`parseOnboardedArtifactProjectConfig`, serialize the executable project shape
back with `serializeOnboardedArtifactProjectConfig`, and create an
artifact-backed runtime with `createOnboardedArtifactRuntimeFromProjectConfig`.
The Onboarded-specific schema is also validated against
`ArtifactProjectConfigSchema`, so package-specific YAML remains compatible with
the generic artifact project contract.
The YAML route declarations also include compatibility projection modes such as
`file` and `values`, so the derived workspace schema no longer needs a separate
TypeScript-only route mode table.

## Validate

```bash
pnpm turbo run build --filter @schema-ide/onboarded-config
node packages/onboarded-config/dist/cli.js validate \
  --dir packages/onboarded-config/projects/onboarded-account-yaml/files \
  --json
```

The same artifact project can be loaded by the generic Schema IDE CLI:

```bash
schema-ide validate \
  --schema packages/onboarded-config/projects/onboarded-account-yaml/schema-ide.config.ts \
  --dir packages/onboarded-config/projects/onboarded-account-yaml/files \
  --json
```

## Web UI

Build the shared playground UI, then start the Onboarded CLI in local filesystem project mode:

```bash
pnpm playground:build
pnpm turbo run build --filter @schema-ide/onboarded-config
node packages/onboarded-config/dist/cli.js web \
  --dir packages/onboarded-config/projects/onboarded-account-yaml/files
```

`web` is an alias for `serve`. The CLI auto-serves `apps/playground/dist` when it
exists; pass `--static-dir <path>` to use another built UI bundle.

## Bundle

`build:bundle` is wired through Turbo to build the package and the playground UI
first. The resulting CommonJS entry embeds the Onboarded artifact project and the
web UI assets, so it can serve `/` without `apps/playground/dist` on disk.

```bash
pnpm turbo run build:bundle --filter @schema-ide/onboarded-config
node packages/onboarded-config/dist/bundle/onboarded-config.cjs validate \
  --dir packages/onboarded-config/projects/onboarded-account-yaml/files \
  --json
```

Run the bundled web UI with:

```bash
node packages/onboarded-config/dist/bundle/onboarded-config.cjs web \
  --dir packages/onboarded-config/projects/onboarded-account-yaml/files
```

Build a Node SEA binary with Node 25.5.0 or newer:

```bash
pnpm turbo run build:sea --filter @schema-ide/onboarded-config -- \
  --out packages/onboarded-config/dist/sea/onboarded-config
```
