# Plan: Schematics — big-bang rename + flavors-as-examples refactor

Status: **proposed**. Supersedes the umbrella-rename half of
[`plan-naming-and-packaging.md`](./plan-naming-and-packaging.md) and folds in its
contained package renames (`alchemy → alchemy`, `algebra → algebra`).

## Vision

**Schematics** is the umbrella framework / harness: a schema-as-source-of-truth
runtime (algebra, artifacts, alchemy, core, ide, cli, agent, server, …). Specific
"flavors" are thin downstream products that bring their own workspace schema,
previews, and deploy provider, then ship a tailored instance.

The end state is **one repo**:

- **`schematics`** (this repo, renamed) — the framework + a top-level
  `examples/` dir where each flavor (onboarded, survey, workflow, …) is a
  **fully-fledged Schematics example**: its own workspace config, previews,
  deploy provider, and runnable instance, built on the public `@schematics/*`
  API. The **playground is a harness that showcases the examples**.

The earlier idea of extracting `onboarded-schematics` into its own repo (with an
npm publish pipeline) is **shelved**. Keeping flavors in-repo as examples
dogfoods the consumer/flavor API without any publish/versioning machinery, and a
clean split stays possible later if it's ever wanted.

Decisions locked for this plan:

- **Scope/name:** `@schematics/*` (plural), workspace `schematics-workspace`.
- **Package renames:** fold `alchemy → alchemy` and `algebra →
algebra` into the scope-rename pass.
- **IDE package:** `react → ide` (demote the IDE to one surface package).
- **Flavor/product API home:** a foundational layer, not the IDE surface —
  React-free types in `@schematics/core`, the component factory re-exported from
  `@schematics/ide`.
- **Distribution:** none for now — single repo, no npm, no publish pipeline.
- **Deploy continuity:** greenfield — rename stack/worker/env identifiers freely,
  **no state migration needed**.
- **Config convention:** rename `schematics.config.ts → schematics.config.ts` now.
- **Flavors live in-repo as examples:** move `onboarded-config` (and the existing
  survey/workflow examples) into a top-level `examples/` dir, each a full flavor;
  the playground showcases them.

## Immediate scope (this pass)

Do this as a **big-bang refactor in one branch / one PR**, but keep it split into
reviewable commits. The scope is the rename **and** the examples-as-flavors
restructure:

- scope/package renames, the three package directory renames, infra identifiers,
  and all `Schematics*` / `schematics` symbol + file renames across the codebase
- move `onboarded-config` + the existing survey/workflow examples into a
  top-level `examples/` tree as full flavors
- reduce `apps/playground` to a harness that showcases those flavors through the
  public `@schematics/*` API
- end green on install, typecheck, test, build, playground build, and smoke serve

No npm publishing or repo split is in scope.

## Two workstreams, one refactor

| Workstream                 | What                                                                                                                                           | Risk                          | Commit order             |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ------------------------ |
| **A. Rename**              | `@schematics/* → @schematics/*` in-repo, demote IDE to a package, fold in `alchemy`/`algebra`, rename all `Schematics*` symbols/files          | Low (all private, mechanical) | First                    |
| **B. Flavors as examples** | Move `onboarded-config` + existing examples into a top-level `examples/` dir as full flavors; playground becomes a harness that showcases them | Medium (consumer-API surface) | After the rename commits |

A creates the new names and public surface. B builds on that within the same
branch/PR.

---

## Effort A — Rename to Schematics

### A1. Package/scope rename map

| Current                        | New                            | Notes                                                            |
| ------------------------------ | ------------------------------ | ---------------------------------------------------------------- |
| `@schematics/agent`            | `@schematics/agent`            |                                                                  |
| `@schematics/artifacts`        | `@schematics/artifacts`        |                                                                  |
| `@schematics/cli`              | `@schematics/cli`              |                                                                  |
| `@schematics/cloudflare`       | `@schematics/cloudflare`       |                                                                  |
| `@schematics/alchemy`          | `@schematics/alchemy`          | dir `packages/alchemy → packages/alchemy`                        |
| `@schematics/core`             | `@schematics/core`             |                                                                  |
| `@schematics/examples`         | `@schematics/examples`         |                                                                  |
| `@schematics/git-artifacts`    | `@schematics/git-artifacts`    |                                                                  |
| `@schematics/protocol`         | `@schematics/protocol`         |                                                                  |
| `@schematics/ide`              | `@schematics/ide`              | demote IDE to a package (dir `react → ide`)                      |
| `@schematics/algebra`          | `@schematics/algebra`          | dir `packages/algebra → packages/algebra`                        |
| `@schematics/server`           | `@schematics/server`           |                                                                  |
| `@schematics/ui`               | `@schematics/ui`               |                                                                  |
| `@schematics/onboarded-config` | `@schematics/onboarded-config` | renamed first, then moved/reworked as a top-level example flavor |
| `schematics-playground` (app)  | `schematics-playground`        |                                                                  |
| `schematics-workspace` (root)  | `schematics-workspace`         |                                                                  |

`pnpm-workspace.yaml` / `turbo.json` globs are path-based (`packages/*`,
`apps/*`) so they don't need edits beyond the two renamed dirs.

### A2. Layers of renaming (do in order, each its own commit)

The 542 `schematics` hits fall into tiers — separate them so review is sane and
deploy state isn't silently orphaned:

1. **Package names + deps** — every `package.json` `name` and `@schematics/*`
   dependency/`workspace:*` ref; `vitest.aliases.ts`; `tsconfig` path mappings;
   import specifiers across `*.ts`/`*.tsx`. Bulk codemod, then `pnpm install` to
   relink the workspace. _Mechanical, safe._
2. **Directory renames** — `alchemy → alchemy`, `algebra →
algebra`, `react → ide`. Use `git mv` so history follows.
3. **Deploy/infra identifiers** — greenfield, so rename freely (no state
   migration), just keep them internally consistent and update CI in lockstep:
   - `alchemy.run.ts` `Alchemy.Stack("schematics", …)` → `"schematics"`.
   - `alchemy/schematics-api-worker.ts` → `schematics-api-worker.ts`.
   - Env vars `VITE_SCHEMATICS_API_BASE_URL`, `SCHEMATICS_API_BASE_URL`,
     `SCHEMATICS_STATIC_DIR` → `VITE_SCHEMATICS_API_BASE_URL`,
     `SCHEMATICS_API_BASE_URL`, `SCHEMATICS_STATIC_DIR`. Update CI/CD secrets.
   - GitHub PR-comment `repository`/`owner` in `alchemy.run.ts` — update when
     the repo is renamed on GitHub.
4. **Public API symbols** — `Schematics`, `SchematicsReflection`,
   `defineSchematicsProduct → defineSchematicsProduct`,
   `createEmbeddedSchematicsCli → createEmbeddedSchematicsCli`,
   `schematics.config.ts → schematics.config.ts`, `schematics-toolkit.ts`, etc.
   Do this — `schematics.config.ts` is the consumer-facing flavor convention and
   we want it right before external flavors exist. Keep it as its own commit so
   the pure scope/path rename remains easy to inspect.

### A3. Repo rename

Rename the GitHub repo `schematics → schematics`. GitHub redirects old URLs, but
update: README badges/links, `alchemy.run.ts` `owner`/`repository`, any CI
references, and the `.git` remote locally.

## Verification

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm playground:build
pnpm run serve:smoke
# grep for stragglers across source, docs, generated metadata, scripts, and CI
rg -n "schematics|schematics|Schematics|schematics|SCHEMATICS|Schematics" \
  --glob '!node_modules' \
  --glob '!dist' \
  --glob '!coverage'
find . -type f \( -name '*schematics*' -o -name '*Schematics*' -o -name '*schematics*' \) \
  -not -path './.git/*' \
  -not -path './node_modules/*' \
  -not -path './*/dist/*'
```

---

## Effort B — Flavors as examples

Instead of extracting `onboarded-schematics` to its own repo, keep everything
in-repo and make each flavor a **fully-fledged example** under a top-level
`examples/` dir, showcased by the playground harness.

The architectural point that still holds: a flavor must **not** depend on the
playground. Today the Onboarded CLI serves `apps/playground/dist` as its UI, but
`apps/playground/src/main.tsx` is a **dev/demo harness** (theme pickers, example
dropdown, workspace-mode probing, "New hosted workspace" button, deploy demo).
The genuinely reusable IDE is just `<SchematicsArtifactProjectView>` from
`@schematics/ide`. The reusable orchestration inlined in `main.tsx`
(workspace-mode probing, chat + deploy wiring, mounting the view) should move
**into `@schematics/ide`** behind `defineSchematicsProduct`; playground-specific
chrome stays in the harness.

Sketch (to be detailed when this effort starts):

```
examples/
  onboarded/     ── workspace config + previews + deploy provider, builds an instance
  survey/        ── full flavor
  workflow/      ── full flavor
apps/playground/ ── harness: lists the example flavors and mounts each via the public API
```

- Each example defines a flavor through the public `@schematics/*` API only — no
  reaching into `packages/*/src`. That dogfoods the consumer/flavor API.
- The playground harness imports the example flavors and renders a picker; this
  replaces today's hard-coded `@schematics/examples` + `onboarded-config` imports
  in `apps/playground/src`.
- The instance build (`build-cli-bundle.mjs`) generalizes: it bundles
  `@schematics/cli` + a flavor's workspace config + a built shell's static
  assets. The `renderPlaygroundAssets()` logic becomes a reusable helper over any
  dist dir.
- A clean repo split remains possible later (publish `@schematics/*`, lift an
  `examples/*` flavor out) but is explicitly out of scope.

**Litmus test for this effort:** an `examples/*` flavor can supply its previews +
deploy service + workspace config through the public API without importing
framework internals. If it can't, the consumer-extension API
([`plan-consumer-extensions.md`](./plan-consumer-extensions.md)) has a gap to fix.

---

## Recommended commit sequence

One big-bang branch / PR, split into commits:

1. **Scope + package names** — codemod `@schematics/* → @schematics/*` in
   `package.json`, imports, aliases, package-manager metadata, scripts, and docs.
2. **Package directory moves** — `git mv packages/alchemy packages/alchemy`,
   `git mv packages/algebra packages/algebra`, and
   `git mv packages/ide packages/ide`; update path references.
3. **Infra/env/resources** — rename stack, worker files, Cloudflare bindings,
   artifacts namespaces, server/playground env vars, CI variables, localStorage
   keys, binary names, and repo/PR-comment identifiers.
4. **Public symbols + config convention** — rename `Schematics`/`schematics`/
   `schematics`/`Schematics` symbols and files, including
   `schematics.config.ts → schematics.config.ts`.
5. **Flavors as examples** — move flavors into top-level `examples/`, reduce
   `apps/playground` to the harness, and move reusable product orchestration into
   `@schematics/ide` behind `defineSchematicsProduct`.
6. **Generated artifacts + docs cleanup** — regenerate example metadata, update
   READMEs/plans, run `pnpm install`, and remove stale generated/lockfile names.
7. **Verification** — make typecheck/test/build/playground/smoke green and do the
   final straggler scan.

## Resolved decisions

- **IDE package:** `react → ide`. ✓
- **Flavor API home:** types in `@schematics/core`, `defineSchematicsProduct`
  re-exported from `@schematics/ide`. ✓
- **Distribution:** none for now — single repo, no npm. ✓
- **Deploy identifiers:** greenfield rename, no state migration. ✓
- **Config convention:** `schematics.config.ts → schematics.config.ts`. ✓
- **Flavors:** in-repo under top-level `examples/`; playground is the harness. ✓
- **Repo split:** shelved (possible later, not planned). ✓
