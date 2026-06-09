# Deploy CLI

How the config-as-code deploy CLI works, how a provider implementation wires one
up, and how a consumer uses it in a repo or CI job.

## Mental Model

The deploy CLI is a thin Node wrapper around the same config-as-code lifecycle as
the engine:

```text
remote API -> pull -> files + config.lock.json
files + lockfile + live remote -> plan
plan -> apply -> remote API + updated config.lock.json
```

The generic CLI harness lives in `@schematics/deploy/node` as `runDeployCliEffect`.
It is intentionally domain-agnostic. It only knows how to:

- parse the common deploy flags;
- create a filesystem `ArtifactStore` rooted at `--dir`;
- run `pull | plan | apply | destroy | fork | merge`;
- render text or JSON output;
- optionally commit pulled snapshots to git.

The domain package supplies the actual deploy engine through `resolveDeploy`.
That function receives the filesystem store and parsed flags, then returns a
`ConfigDeploy` built for the target API, environment, and account.

```ts
runDeployCliEffect(argv, {
  projectId: "my-project",
  name: "my-deploy",
  resolveDeploy: ({ store, flags }) =>
    Effect.succeed(makeMyConfigDeploy({ store, api: makeApi(flags) })),
});
```

## Filesystem Contract

Every deploy command operates on a directory:

```bash
my-deploy pull --dir ./envs/prod
```

That directory is the sync target. It contains authored resource files plus a
`config.lock.json` lockfile. The lockfile maps stable human slugs to opaque
remote ids, so future plans can tell whether a file means "update this remote
object" or "create a new object."

The directory boundary is also what makes side-by-side environments simple:

```text
envs/
  staging/
    config.lock.json
    branches/main.yaml
  prod/
    config.lock.json
    branches/main.yaml
```

Each target directory has its own lockfile and can be diffed with normal git or
filesystem tools.

## Commands

### `pull`

Fetches remote resources and writes the materialized files into `--dir`.

```bash
catalog-deploy pull --dir ./envs/prod --account nypl
```

Use `--commit` to create a git commit containing the pulled files and
`config.lock.json`:

```bash
catalog-deploy pull --dir ./envs/prod --account nypl --commit
```

### `plan`

Diffs the files and lockfile against live remote state.

```bash
catalog-deploy plan --dir ./envs/prod
```

Text output uses the same Terraform-style renderer as the engine. `--json`
returns the structured plan.

```bash
catalog-deploy plan --dir ./envs/prod --json
```

### `apply`

Plans first, then applies the result only when `--auto-approve` is present.
Without approval it prints the plan and exits without mutating the remote.

```bash
catalog-deploy apply --dir ./envs/prod
catalog-deploy apply --dir ./envs/prod --auto-approve
```

Deletes are still gated separately. If the plan includes deletes, pass
`--allow-delete` as the second explicit opt-in:

```bash
catalog-deploy apply --dir ./envs/prod --auto-approve --allow-delete
```

An apply exits non-zero when the engine aborts because the remote changed under
the plan.

### `destroy`

Deletes every config-managed remote resource. It requires `--auto-approve`.

```bash
catalog-deploy destroy --dir ./envs/scratch --auto-approve --allow-delete
```

### `fork` and `merge`

These are local git helpers for draft config branches. They do not construct a
deploy engine.

```bash
catalog-deploy fork --dir ./envs/prod --branch draft/add-branches
catalog-deploy merge --dir ./envs/prod --branch draft/add-branches --into main
```

## Common Flags

| Flag               | Meaning                                                                                            |
| ------------------ | -------------------------------------------------------------------------------------------------- |
| `--dir <dir>`      | Required sync target directory.                                                                    |
| `--account <name>` | Common consumer selector. The generic harness stores it; the implementation decides what it means. |
| `--auto-approve`   | Permit `apply` or `destroy` to mutate the remote.                                                  |
| `--allow-delete`   | Permit delete changes during apply.                                                                |
| `--commit`         | Commit pulled snapshots to git.                                                                    |
| `--json`           | Print structured JSON instead of human text.                                                       |
| `--branch <name>`  | Branch used by `fork` and `merge`.                                                                 |
| `--into <name>`    | Target branch for `merge`; defaults to `main`.                                                     |

Unknown `--flag value` pairs are preserved in `flags.rest`. Implementations use
that escape hatch for domain-specific flags until the CLI is migrated to typed
`effect/unstable/cli` descriptors.

The catalog example uses `--mock-state <file>` through `flags.rest`:

```bash
catalog-deploy apply \
  --dir ./tmp/catalog \
  --account nypl \
  --mock-state ./tmp/remote.json \
  --auto-approve
```

## Implementing a Domain CLI

A provider implementation needs three pieces:

1. A `ConfigDeploy` factory for its domain.
2. A `runXDeployCliEffect(argv, options)` function that calls the generic harness.
3. A tiny executable bin that passes `process.argv` into that runner.

The catalog example is the reference implementation:

- `examples/catalog/src/deploy.ts` builds `makeCatalogConfigDeploy`.
- `examples/catalog/src/deploy-cli.ts` adapts the generic harness.
- `examples/catalog/src/deploy-cli-bin.ts` is the executable bin.

### 1. Build the deploy engine

The engine is the API adapter plus artifact store plus provider registry:

```ts
import type { ArtifactStore } from "@schematics/artifacts";
import type { DeployCliFlags } from "@schematics/deploy/node";
import { makeMyConfigDeploy } from "./deploy";
import { makeMyApi } from "./api";

function resolveDeploy(store: ArtifactStore, flags: DeployCliFlags) {
  const api = makeMyApi({
    account: flags.account,
    token: process.env["MY_API_TOKEN"],
    baseUrl: typeof flags.rest["base-url"] === "string" ? flags.rest["base-url"] : undefined,
  });

  return makeMyConfigDeploy({ store, api, projectId: "my-project" });
}
```

The generic harness creates the filesystem store for you from `--dir`; do not
open or parse files in the implementation unless the domain genuinely needs an
extra sidecar.

### 2. Adapt `runDeployCliEffect`

```ts
import {
  runDeployCliEffect,
  type DeployCliOptions,
  type DeployCliResult,
} from "@schematics/deploy/node";
import { Effect } from "effect";

export function runMyDeployCliEffect(
  argv: readonly string[],
  options: DeployCliOptions = {},
): Effect.Effect<DeployCliResult> {
  return runDeployCliEffect(
    argv,
    {
      projectId: "my-project",
      name: "my-deploy",
      commitMessage: (flags) => `Pull ${flags.account ?? "default"} snapshot`,
      resolveDeploy: ({ store, flags }) => Effect.succeed(resolveDeploy(store, flags)),
      afterMutate: (flags) => persistLocalMockIfNeeded(flags),
    },
    options,
  );
}
```

`afterMutate` is optional. Use it only when the target API is an in-memory or
file-backed mock whose state must be saved after `apply` or `destroy`. Live API
clients usually do not need it.

### 3. Add a bin entry

```ts
#!/usr/bin/env node
import { NodeRuntime } from "@effect/platform-node";
import { Effect } from "effect";
import { runMyDeployCliEffect } from "./deploy-cli";

NodeRuntime.runMain(
  runMyDeployCliEffect(process.argv.slice(2)).pipe(
    Effect.tap((result) =>
      Effect.sync(() => {
        if (result.stdout) process.stdout.write(`${result.stdout}\n`);
        if (result.stderr) process.stderr.write(`${result.stderr}\n`);
        process.exitCode = result.exitCode;
      }),
    ),
  ),
);
```

Then expose it from `package.json`:

```json
{
  "bin": {
    "my-deploy": "./dist/deploy-cli-bin.js"
  },
  "exports": {
    "./deploy": {
      "types": "./src/deploy-cli.ts",
      "import": "./dist/deploy-cli.js"
    }
  }
}
```

Keep this CLI on a Node-only subpath. Do not re-export it from a browser-safe
package root if that root is consumed by the IDE.

## Consumer Workflow

For a team using a domain package, the normal loop is:

```bash
# 1. Bootstrap files from remote
my-deploy pull --dir ./envs/staging --account staging

# 2. Edit files in ./envs/staging with the IDE, an editor, or a review branch

# 3. Review changes against live remote
my-deploy plan --dir ./envs/staging

# 4. Apply after review
my-deploy apply --dir ./envs/staging --auto-approve
```

For production, keep the directory in git and require PR review:

```bash
my-deploy pull --dir ./envs/prod --account prod --commit
git diff main -- ./envs/prod
my-deploy plan --dir ./envs/prod
```

In CI, prefer JSON when another tool needs to inspect the result:

```bash
my-deploy plan --dir ./envs/prod --json > plan.json
```

## Relationship To Deploy Services And Profiles

The UI talks to `SchematicsDeployService`, which now supports saved
secret-free connection records through `DeployConnectionStore`. The current CLI
still builds `ConfigDeploy` directly in process through `resolveDeploy`.

The planned unification keeps the same filesystem target model but moves the
CLI onto the deploy service contract:

- profiles resolve to `DeployConnectRequest`;
- `--profile` selects a saved connection plus target directory;
- the CLI renders the same `DeployEvent` stream the UI consumes;
- consumer-specific flags become typed `effect/unstable/cli` descriptors instead
  of entries in `flags.rest`.

Until that migration lands, implementers should keep domain-specific connection
resolution in `resolveDeploy` and keep credentials out of files. Consumers should
treat `--dir` as the durable sync target and commit only the generated config
files plus `config.lock.json`, never secrets.
