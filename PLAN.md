# Schema IDE Monorepo Extraction Plan

## Context

This repository is intended to become the standalone, open-source monorepo for
Schema IDE.

The source being extracted came from:

```text
/Users/benjacobson/.superset/worktrees/34bcd7f4-b5a8-4b51-a252-428f0d0951cb/schema-agent/packages/schema-ide
```

That source directory is already a self-contained pnpm/Turborepo workspace. It
was originally nested inside a larger host monorepo at `packages/schema-ide`, so
some docs and commands still reference `packages/schema-ide`.

The current destination repository is:

```text
/Users/benjacobson/Development/personal/schema-ide
```

At the time this plan was written, the destination repo had copied content under:

```text
packages/schema-ide
packages/schema-ide-compat
packages/schema-algebra
```

Git saw all copied files as untracked.

## Current Findings

### `packages/schema-ide`

`packages/schema-ide` matches the original extracted Schema IDE workspace. Its
important root files are:

```text
packages/schema-ide/package.json
packages/schema-ide/pnpm-workspace.yaml
packages/schema-ide/pnpm-lock.yaml
packages/schema-ide/tsconfig.base.json
packages/schema-ide/turbo.json
packages/schema-ide/turbo.standalone.json
packages/schema-ide/vitest.aliases.ts
packages/schema-ide/.gitignore
packages/schema-ide/.github
packages/schema-ide/README.md
packages/schema-ide/LICENSE
packages/schema-ide/CONTRIBUTING.md
```

Its workspace packages currently live directly under that nested directory:

```text
packages/schema-ide/core
packages/schema-ide/protocol
packages/schema-ide/agent
packages/schema-ide/react
packages/schema-ide/server
packages/schema-ide/ui
packages/schema-ide/examples
packages/schema-ide/playground
```

The package graph uses `@schema-ide/*` workspace dependencies.

### `packages/schema-ide-compat`

`packages/schema-ide-compat` is a temporary host-monorepo compatibility package.
It is named `@open-ontology/schema-ide` and mostly re-exports the split
`@schema-ide/*` packages.

Do not include it in the initial standalone open-source repo unless there is a
deliberate product decision to publish or preserve that compatibility surface.

### `packages/schema-algebra`

`packages/schema-algebra` is a separate package named
`@schema-ide/schema-algebra`.

Keep it in the new monorepo as an independent package. It may be used by Schema
IDE in the future, but should not be coupled to Schema IDE during this extraction
unless a concrete dependency is introduced.

### Generated Artifacts

The copied tree contains generated or local-only directories:

```text
node_modules
dist
.turbo
```

These exist in multiple package directories and should be removed before the
first commit. `.DS_Store` should also be removed.

## Target Repository Shape

Make the repository root the real pnpm/Turborepo workspace root.

Preferred layout:

```text
schema-ide/
  package.json
  pnpm-workspace.yaml
  pnpm-lock.yaml
  turbo.json
  tsconfig.base.json
  vitest.aliases.ts
  .gitignore
  .github/
  README.md
  LICENSE
  CONTRIBUTING.md
  PLAN.md
  packages/
    core/
    protocol/
    agent/
    react/
    server/
    ui/
    examples/
    schema-algebra/
  apps/
    playground/
```

Avoid keeping a nested `packages/schema-ide` workspace in this repo. This repo
itself is the Schema IDE monorepo.

## Migration Steps

### 1. Promote Workspace Root Files

Move these files from `packages/schema-ide` to the repository root:

```text
package.json
pnpm-workspace.yaml
pnpm-lock.yaml
tsconfig.base.json
turbo.json
turbo.standalone.json
vitest.aliases.ts
.gitignore
.github/
README.md
LICENSE
CONTRIBUTING.md
```

After the move, decide whether `turbo.standalone.json` is still needed. It was
used so the nested workspace could run inside the host monorepo. In the new
standalone root monorepo, the normal `turbo.json` should be enough unless there
is a specific compatibility reason to retain `turbo.standalone.json`.

### 2. Move Schema IDE Packages

Move the Schema IDE packages into root-level `packages/*`:

```text
packages/schema-ide/core      -> packages/core
packages/schema-ide/protocol  -> packages/protocol
packages/schema-ide/agent     -> packages/agent
packages/schema-ide/react     -> packages/react
packages/schema-ide/server    -> packages/server
packages/schema-ide/ui        -> packages/ui
packages/schema-ide/examples  -> packages/examples
```

Move the playground into `apps/*`:

```text
packages/schema-ide/playground -> apps/playground
```

Keep schema algebra as a first-class package. This package is the renamed and
expanded successor to the earlier relation experiment:

```text
packages/schema-relations -> packages/schema-algebra
```

Remove the emptied `packages/schema-ide` directory after its contents are moved.

### 3. Exclude Compatibility Package

Remove or leave untracked outside the final repo structure:

```text
packages/schema-ide-compat
```

This package is host-monorepo migration scaffolding, not part of the clean
standalone Schema IDE monorepo.

### 4. Update `pnpm-workspace.yaml`

Change the workspace package list from direct nested package names:

```yaml
packages:
  - "core"
  - "protocol"
  - "agent"
  - "react"
  - "server"
  - "ui"
  - "examples"
  - "playground"
```

to monorepo globs:

```yaml
packages:
  - "packages/*"
  - "apps/*"
```

Keep the existing catalog versions and overrides unless verification exposes a
real dependency issue.

### 5. Update Root `package.json` Scripts

The root package should represent the monorepo. Use root-level Turbo commands
instead of commands scoped to the old nested workspace.

Recommended script intent:

```json
{
  "scripts": {
    "build": "turbo run build",
    "dev": "pnpm run build && sh -c 'pnpm run dev:server & server_pid=$!; sleep 1; if ! kill -0 $server_pid 2>/dev/null; then wait $server_pid; exit 1; fi; trap \"kill $server_pid 2>/dev/null || true\" EXIT INT TERM; pnpm run dev:playground'",
    "dev:server": "pnpm --dir packages/server dev",
    "dev:playground": "pnpm --dir apps/playground dev",
    "format": "oxfmt",
    "format:check": "oxfmt --check",
    "playground:build": "pnpm --dir apps/playground build",
    "serve": "pnpm run build && pnpm run playground:build && SCHEMA_IDE_STATIC_DIR=../../apps/playground/dist pnpm --dir packages/server start",
    "serve:smoke": "node scripts/smoke-serve.mjs",
    "test": "turbo run test",
    "typecheck": "turbo run typecheck"
  }
}
```

Check `serve` carefully after moving files. From `packages/server`, the built
playground should be reachable at `../../apps/playground/dist`.

### 6. Update Package Config Paths

Each package moved from `packages/schema-ide/<name>` to `packages/<name>` gains
one more directory level relative to the root. Check and update:

```text
packages/*/tsconfig.json
packages/*/vitest.config.ts
packages/*/tsdown.config.ts
apps/playground/tsconfig.json
apps/playground/vite.config.ts
```

Common fixes likely include:

```text
../tsconfig.base.json   -> ../../tsconfig.base.json
../vitest.aliases.ts    -> ../../vitest.aliases.ts
```

For `apps/playground`, use paths relative to `apps/playground`.

### 7. Update `vitest.aliases.ts`

Update aliases from the old root-local package layout:

```ts
"@schema-ide/core": resolve(rootDir, "core/src/index.ts")
```

to the new monorepo layout:

```ts
"@schema-ide/core": resolve(rootDir, "packages/core/src/index.ts")
```

Do this for all split packages:

```text
@schema-ide/agent
@schema-ide/core
@schema-ide/examples
@schema-ide/protocol
@schema-ide/react
@schema-ide/server
@schema-ide/ui
```

### 8. Update Docs

Update documentation that still assumes the old host-monorepo path.

Examples:

```text
pnpm --dir packages/schema-ide dev
pnpm --dir packages/schema-ide/server dev
pnpm --dir packages/schema-ide serve
```

should become:

```text
pnpm dev
pnpm --dir packages/server dev
pnpm serve
```

Also update references to the playground path:

```text
packages/schema-ide/playground
```

to:

```text
apps/playground
```

Some planning docs under the old Schema IDE tree intentionally describe the
historical extraction from the host monorepo. Do not blindly rewrite historical
context if doing so makes those docs inaccurate. Prefer updating active
developer-facing commands in `README.md`, package READMEs, and CI workflow files
first.

### 9. Update GitHub Workflows

After moving `.github` to the root, update workflow paths for the new layout.

In `.github/workflows/playground-pages.yml`, change the artifact path:

```yaml
path: playground/dist
```

to:

```yaml
path: apps/playground/dist
```

The root install/build/test/typecheck commands should work after the root
scripts and workspace globs are updated.

### 10. Move Scripts

Move:

```text
packages/schema-ide/scripts/smoke-serve.mjs -> scripts/smoke-serve.mjs
```

Then inspect it for old path assumptions. Update any references to the old
nested workspace or playground location.

### 11. Clean Generated Files

Remove copied generated artifacts before the first commit:

```text
.DS_Store
**/node_modules
**/dist
**/.turbo
*.tsbuildinfo
```

Do not remove source files, tests, package manifests, or lockfiles.

### 12. Verify

From the repository root, run:

```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm test
pnpm typecheck
pnpm build
pnpm playground:build
pnpm serve:smoke
```

If `pnpm install --frozen-lockfile` fails because paths changed in
`pnpm-lock.yaml`, update the lockfile with:

```bash
pnpm install
```

Then rerun the full verification set.

## Publishing Follow-Up

The current packages are pre-1.0 and mostly marked:

```json
{
  "version": "0.0.0",
  "private": true
}
```

Before publishing to npm, make an explicit package policy decision:

- package scope: keep `@schema-ide/*`, change scope, or reserve both
- package versions
- which packages are public
- `license`, `repository`, `homepage`, and `bugs` metadata
- `publishConfig`
- `files` allowlists
- whether emitted declaration files should be referenced from `dist` instead of
  `src`

Do not combine publishing cleanup with the structural migration unless necessary.
First make the monorepo install, test, typecheck, build, and serve cleanly.

## Open Decisions

- Should `turbo.standalone.json` be removed after the repo becomes standalone?
- Should `@schema-ide/schema-algebra` keep its current package name, or move
  under a Schema IDE package scope later?
- Should the open-source repo initially publish packages, or remain source-only
  until the public API is reviewed?
- Should historical planning docs be kept in the repo, moved under `docs/`, or
  omitted before the first public commit?
