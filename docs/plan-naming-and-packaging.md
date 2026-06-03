# Plan: Naming & packaging

Captures the naming discussion for the config-as-code package and the umbrella
project. Status: **proposed** (no rename executed yet).

## Context

All packages are private/unpublished under the `@schematics/` scope, so renames
carry no external/npm risk. The family is already slightly inconsistent:

- `@schematics/artifacts` — no prefix
- `@schematics/algebra` — "schema" doubled (scope already says it)
- `@schematics/alchemy` — generic name, undersells the package

## 1. Package: `alchemy` → `alchemy`

`alchemy` is accurate but bland — it's a general config-as-code engine, not
just "deploy". **`@schematics/alchemy`** is better:

- Direct homage to the tool whose resource lifecycle we mimicked from first
  principles; anyone who knows Alchemy immediately gets it.
- The metaphor fits: alchemy = _transmutation_ — turning desired state
  (schema-validated files) into deployed reality via `plan → apply`.
- Pairs with the other pillars: **algebra / artifacts / alchemy**.

Refinement: under the `@schematics` scope, drop the redundant `schema-` prefix —
`@schematics/schema-alchemy` stutters. Use `@schematics/alchemy`, and fix
`algebra → algebra` for consistency, giving the triad
`@schematics/{algebra, artifacts, alchemy}`.

Caveat: "alchemy" is adjacent to the real Alchemy product (alchemy.run). Fine for
a private/internal package (homage, not affiliation). Safe-but-duller
alternatives if we want to avoid the adjacency: `deploy`, `reconcile`.

### Migration (contained, low-risk)

`alchemy → @schematics/alchemy` touches:

- `packages/alchemy/` → `packages/alchemy/` (dir + `package.json` name)
- consumers: `@schematics/onboarded-config` imports, `vitest.aliases.ts`,
  `pnpm-workspace`/turbo (glob-based, no change), the two READMEs.

Doable in a single focused PR. Optionally fold `algebra → algebra` in the
same pass (also internal-only).

## 2. Project: `schematics` is now too narrow

The key realization from the config-as-code work: **deploy (`alchemy`) is a peer
pillar, not part of an "IDE".** The project grew four pillars around one thesis —
_the schema is the contract between human, agent, and runtime_:

| Pillar     | Package(s)            | Concern                                  |
| ---------- | --------------------- | ---------------------------------------- |
| meaning    | `algebra`             | relations, graphs, diffs, lenses         |
| storage    | `artifacts`           | files as typed, schema-routed artifacts  |
| deployment | `alchemy`             | config-as-code `pull/plan/apply/destroy` |
| authoring  | `core`, `react`/`ide` | editor, reflection, agent tools          |

The IDE is **one surface**, yet it's also the umbrella name — that's the tension.
Cleaner: **demote the IDE to a package** (`@<scope>/ide`) and give the project a
broader umbrella meaning "schema as source of truth".

### Umbrella name candidates

- **Schematic** _(top pick)_ — literally contains "schema", _means_ a structured
  blueprint/plan (exactly what these schemas are), reads as a platform.
  `@schematic/{algebra, artifacts, alchemy, core, ide, cli, agent}`.
- **Schemata** — the elegant plural of schema as the substrate.
- **Schema Studio** — "studio" is broader than "ide" (authoring + deploy).

### Migration (large, own PR)

Scope rename `@schematics/* → @schematic/*` + demoting the IDE is mechanical but
broad: every `package.json`, import, `vitest.aliases.ts`, `alchemy.run.ts`,
Cloudflare worker config, and docs. Should be its own PR, ideally after the
contained package rename lands.

## Recommendation

1. Now: `alchemy → @schematics/alchemy` (+ optional `algebra →
algebra`). Contained.
2. Later (separate PR): umbrella rename to **Schematic**, demoting `ide` to a
   package, once the pillar model has settled.
