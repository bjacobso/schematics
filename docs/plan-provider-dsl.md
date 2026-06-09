# Plan: Provider authoring DSL (`resource → provider → stack → env`)

Status: **proposed**. Resolves the upstream request
[`onboarded-schematics/docs/upstream/05-flavor-dsl.md`](https://github.com/) (the
"flavor DSL" umbrella). Builds on the flavors-as-examples work
([`plan-schematics.md`](./plan-schematics.md) Effort B) and the `SchematicsFlavor`
/ `SchematicsProduct` surface now in `@schematics/core` + `@schematics/ide`.

## Why

Standing up a domain config-as-code project today means hand-assembling the
framework's low-level primitives (`defineResource`, `makeConfigDeploy`, artifact
routes, a mock API, a deploy CLI) across many files. In the reference consumer
`onboarded-schematics` that's **~3,679 lines across 28 files** — but only ~390 are
genuinely domain-specific (per-entity schemas + config⇄wire mappers). The other
~85% is mechanical or framework-generic and should be **derived**.

An author should declare the ~390 lines that are theirs and get the artifact
project, reconciler, relation/workspace schema + validation, in-memory mock, and
CLI/deploy-service for free.

## The model: four tiers

The unit that composes is **not** the whole repo ("a flavor") — it's one external
system. A repo blends several. So the model is four tiers, named after the IaC
tools whose **plan/apply/state** model we already share, with the one tier those
tools leave informal (the per-system one) filled by Terraform/Pulumi's `provider`:

```
resource  →  one object type                          (Stripe Product, Onboarded Form)
provider  →  one system: its resources + transport     (Stripe, Salesforce, Onboarded)
stack     →  the authored blend of providers           (the repo / IDE surface, versioned)
env       →  a target a stack applies to               (prod / staging — per-provider connections + creds)
```

- A **resource** belongs to a **provider**. A **stack** blends providers. A stack
  applies to one or more **envs**; each env supplies the per-provider connection +
  credentials.
- `stack ↔ env` is **one stack, many envs**: the stack is the stable, versioned
  thing you edit; an env is where you point it. "Two Salesforce orgs" = two envs
  (or two connections within an env), not two stacks.

### Naming rationale

| Tier               | Word           | Why this word                                                                                                                                                                                                                    |
| ------------------ | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| object type        | **`resource`** | Universal across Terraform/Pulumi/Crossplane/CDK; already the noun in `@schematics/alchemy` (`defineResource`).                                                                                                                  |
| system + transport | **`provider`** | The truest analog (Terraform/Pulumi/Crossplane `provider`); the one tier Alchemy/CDK leave informal, which blending forces us to formalize.                                                                                      |
| instance / env     | **`env`**      | Plainest possible word — and already the de-facto term here: `DeployConnectionOptions.environments` is `[localhost, staging, production]` (`examples/catalog/src/connection.ts`).                                                |
| authored blend     | **`stack`**    | Matches the vernacular "our stack" = the set of systems we run = a blend of providers. (Diverges from Pulumi/Alchemy, where `stack`/`stage` is the _env_ tier — accepted: the everyday meaning wins for a consumer-facing tool.) |

Prior art surveyed: Terraform/OpenTofu (`resource`/`provider`/`workspace`/`module`),
Pulumi (`resource`/`provider`/`stack`/`project`), AWS CDK (`construct`/library/
`environment`/`app`), Crossplane (`Managed Resource`/`Provider`/`ProviderConfig`/
`Configuration`), Alchemy (`Resource`/—/`stage`/`app`·`Scope`), Backstage
(`entity`/`integration`/—/`catalog`), Fivetran/Airbyte (`stream`/`connector`/
`connection`), Steampipe (`table`/`plugin`/`connection`/`mod`).

> Note on the internal name clash: `@schematics/alchemy` currently calls the
> _per-resource CRUD adapter_ a `ConfigProvider` and `defineResource` _returns_
> one — backwards from this model. Adopting `provider` for the per-system tier
> means renaming the internal type `ConfigProvider → ResourceHandler` (or
> `ResourceAdapter`). That's a latent inversion worth fixing regardless.

## The DSL surface

### `defineResource` — one object type, everything about it co-located

```ts
const Form = defineResource({
  kind: "OnboardedForm",                 // namespaced as <provider>.OnboardedForm
  route: "forms/*.yaml",                 // → artifact-project route
  key: "id",                             // → slug / identity / lockfile binding
  schema: OnboardedFormConfigSchema,     // config-file schema
  decode: (dto) => formConfigFromDto(dto),                  // wire → config
  encode: { create: formCreateDtoFromConfig,                // config → wire
            update: formUpdateDtoFromConfig },
  remote: (api) => api.forms,            // typed list/get/create/update/delete
  refs:   { attributePaths: ref("OnboardedCustomProperty", "path") },
  seed:   [ /* sample wire DTOs */ ],    // → drives the derived mock

  // — escape hatches (all optional) —
  writeOps: "full",                      // | "create-only" | "deprecate" | "read-only"
  slug: (e) => slugify(e.props.name),    // identity stability for filenames
  list: (api) => /* custom filter/paginate */,   // default: page-walk remote.list
  detail: (api, summary) => /* fetch-per-summary */,
  computed: { path: (c) => `employee.custom.${c.name}` },  // server-derived fields
  refResolution: "lockfile",             // | "context" | "identity"
  validate: (value, ctx) => /* extra per-resource diagnostics */,
  errors: { "unresolved-ref": (rel) => `Unknown form: ${rel.id}` },
});
```

### `defineProvider` — one system: its resources + transport + envs

```ts
export const Onboarded = defineProvider({
  id: "onboarded",                       // → route/kind namespace, e.g. onboarded/forms/*.yaml
  title: "Onboarded Account Config",
  resources: [Account, CustomProperty, Form, Policy, Automation],
  connection: ONBOARDED_CONNECTION_OPTIONS,        // env list + auth methods (the `env` tier)
  transport: ({ httpClient }) => makeOnboardedClientApi({ httpClient }),  // builds the live api
  mockTransport: (seed) => /* derived by default; override only if needed */,
});
```

From `resources` + `connection` + `transport`, a provider derives:

- **artifact project** — routes from `route`, schemas from `schema`, namespaced by `id`;
- **reconciler** — a `ResourceHandler` per resource from `key`/`remote`/`encode`/`decode`/`refs`, in dependency order (topo-sorted from `refs`);
- **relation/workspace schema + cross-file validation** — from `schema` + `refs` + per-resource `validate`;
- **in-memory mock** — a generic store keyed per resource (`key`) with CRUD matching `remote`, seeded from `seed` (deletes the ~970-line bespoke mock);
- **deploy service + CLI** — `pull/plan/apply/destroy/validate/web`, with live transport built from `connection` per `env`.

### `defineStack` — blend providers into the authored repo surface

```ts
export const Acme = defineStack({
  id: "acme-config",
  providers: [Stripe, Salesforce, Sentry],
  // cross-provider refs resolve across the blended graph (see Blending §)
});

// the whole consumer index.ts:
export const { cli, deploy, project, mock, schema } = Acme;
```

A single-provider stack (`providers: [Onboarded]`) is the common case and replaces
today's hand-wired `defineSchematicsProject`.

### `env` — connection config, not a `define*`

`env` is data, not a constructor: it's the existing `DeployConnectionOptions`
(`environments` + `authMethods`) attached per provider. The deploy panel selects an
env + auth method; the service resolves the per-provider transport from it. A stack
applied to `prod` connects each of its providers with that env's credentials.

## Derived vs. author-supplied

| Concern                       | Derived                               | Author overrides via        |
| ----------------------------- | ------------------------------------- | --------------------------- |
| Config schema                 | — (authored)                          | the `schema` itself         |
| Routes / artifact project     | from `route` + resource set           | route metadata              |
| Reconciler wiring             | from `encode`/`decode`/`key`/`remote` | `errors`, `refResolution`   |
| In-memory mock                | from `seed` + `encode`/`decode`/`key` | `mockTransport`, `writeOps` |
| CLI + deploy service          | fully, from provider                  | custom commands             |
| Workspace validation          | from relation schema + `refs`         | `validate`, `errors`        |
| List / pagination             | default page-walk of `remote.list`    | `list`, `detail`            |
| Server-only / computed fields | auto-dropped / `computed`             | `computed`                  |

### Escape hatches (the consumer proves each is mandatory)

- **Partial CRUD** (`writeOps`): `full | create-only | deprecate | read-only`.
  Custom properties = deprecate-only; automations = create-only; Account/Catalog
  container = read-only.
- **List overrides**: forms filter `organization | global`; default is page-walk.
- **Detail-on-list** (`detail`): automations fetch a detail per summary.
- **Computed fields** (`computed`): custom-property `path = <entity>.custom.<name>`.
- **Ref resolution** (`refResolution`): policies resolve form refs via lockfile on
  read, via apply-context on write.
- **Custom validation + messages** (`validate`, `errors`): policy rule-fact paths.

## `project` / `workspace` reconciliation

Three near-synonyms must not coexist. Resolution:

- **`stack`** replaces **`defineSchematicsProject`** as the top authored unit. A
  single-provider stack ≈ today's "project."
- **`ArtifactProject`** (the routes/files declaration) stays an internal primitive
  a provider derives; it is not consumer-facing vocabulary.
- **"workspace"** = the IDE's _editing view_ of a stack (the merged file tree +
  panels). It remains a UI term, not an authoring noun.

So consumer-facing: `resource / provider / stack / env`. Internal/derived:
`ArtifactProject`, `ResourceHandler`, the deploy engine. UI: "workspace".

## Blending: the structural shapes a multi-provider stack forces

1. **Namespacing.** Two providers can't both own `accounts/*.yaml` or kind
   `Account`. Each provider namespaces by `id`: tree `stripe/products/*.yaml`, kind
   `stripe.Product` (Terraform's `aws_`/`stripe_` prefix). Decided at Phase 1.
2. **Per-env, per-provider connections.** A stack on `prod` holds one connection
   per provider; the deploy panel/protocol become multi-connection. Separate the
   provider _definition_ from a _connection instance_ so two Salesforce orgs = two
   envs/connections, not two providers.
3. **Cross-provider references — the payoff.** The reason to blend in _one_ repo:
   a shared config graph across systems (a Sentry project referencing a Salesforce
   account id). The Relation algebra already does refs; resolving + validating +
   visualizing them _across_ providers is the differentiator. **v2** — v1 lays only
   the namespacing groundwork (see Resolved decisions); there is no near-term
   multi-provider consumer.
4. **Registry trajectory.** Providers are shareable units —
   `@schematics/provider-stripe`, `@schematics/provider-salesforce` a consumer
   installs and blends (the Terraform Registry / Backstage-plugin model). Today's
   `examples/*` become first-party providers; the in-repo examples seed a registry.
   Keep package boundaries from fighting this.

## Where it lives

- **New package `@schematics/provider`** — `defineResource` / `defineProvider` /
  `defineStack`. Depends on `core`, `artifacts`, `algebra`, `alchemy`, `protocol`,
  `cli`.
- **Promote `examples/_shared` (`@schematics/example-shared`) → a framework
  package** (e.g. `@schematics/deploy`): `makeConfigDeployService`, the deploy-CLI
  harness, secret store, fs-store, codec are framework-generic and shouldn't live
  under `examples/`. The DSL composes them.
- **Rename internal `ConfigProvider → ResourceHandler`** in `@schematics/alchemy`
  (+ catalog), freeing `provider` for the per-system tier.

## Phasing (each independently shippable; validated against the in-repo catalog)

The catalog is the hardest in-repo case (scoped sub-entities, derived ids, path
refs). Migrating it is the proof — if the DSL expresses catalog, it expresses
onboarded.

0. **Promote `_shared` → `@schematics/deploy`; rename `ConfigProvider →
ResourceHandler`.** Pure moves/renames; catalog + onboarded keep working via
   re-export. Green typecheck/test.
1. **`defineResource` type + pure derivations (no backend).** Derive the artifact
   project, relation/workspace schema, and cross-file validation from a resource
   set. _Validate:_ equality with hand-written `CatalogArtifactProject` /
   `CatalogWorkspaceSchema` / `validateCatalogWorkspaceValue`. Decide namespacing
   and embedded-sub-entity handling here.
2. **Derive the reconciler.** A `ResourceHandler` per resource (via the renamed
   `defineResource`) in dependency order → `makeProviderConfigDeploy`. _Validate
   against_ `makeCatalogConfigDeploy`.
3. **Derive the in-memory mock.** Generic keyed store + CRUD + seed + call log;
   honor `writeOps`/`computed`. _Validate:_ round-trips pull/plan/apply identically
   to the hand-written mock.
4. **`defineProvider` + `defineStack`.** Compose resources + connection + transport
   → derived deploy service, CLI, and a `SchematicsProduct`/`SchematicsFlavor` so it
   drops into the IDE/playground harness with zero glue. v1 `defineStack` takes a
   single provider (namespaced); multi-provider blending + cross-provider ref
   resolution is v2.
5. **Dogfood: migrate `examples/catalog`** to the DSL; delete derivable provider/
   mock/project/validation; keep escape hatches (read-only catalog container,
   scoped sub-entities). Catalog tests + playground e2e stay green.
6. **(consumer, out of framework scope) migrate `onboarded-schematics`** — its
   `index.ts` exports `{ cli, deploy, project, mock }` from `defineStack` /
   `defineProvider` with no hand-written mock/reconciler/deploy-CLI. Validates the
   escape hatches end to end.

## Resolved decisions

- **v1 scope: single-provider stacks.** ✓ There is no near-term multi-provider
  consumer (blending is forward-looking). v1 ships single-provider stacks — which
  cover catalog **and** onboarded fully — and only _designs for_ blending. This
  keeps Phases 0–5 small and shippable.
- **Embedded sub-entities: no nested-resource construct.** ✓ Nested entities
  (catalog Editions/Copies/Holds) are part of the **parent resource's `schema`** (a
  relation-annotated Effect schema); `defineResource` models **file-level**
  resources only. v1 file-per-resource expresses catalog because its _files_ are
  one-per-top-level-entity. The only escape hatch this would ever need —
  "sub-entity with its own remote endpoint" — has no consumer and is deferred.
  _Phase 1 is unblocked._
- **Cross-provider refs: v2.** ✓ v1 namespaces kinds/routes by provider `id`
  (`stripe.Product`, `stripe/products/*.yaml`) as cheap groundwork; cross-provider
  resolution + validation + visualization lands in v2 when a real blend exists.
- **Multi-instance (`env`): v2.** ✓ v1 keeps the existing one-env-active model;
  provider _definition_ is separated from _connection_ so simultaneous
  multi-instance (two Salesforce orgs) is possible later without a rewrite.
- **Type-level derivation: `as` casts in v1.** ✓ Deriving the workspace-schema
  struct _type_ from a resource tuple is heavy generics; ship with casts and
  tighten later.
- **Transport: not blocked on upstream 01/03.** ✓ The DSL wires the author's
  existing transport (the `makeOnboardedClientApi` / `makeMockCatalogApi` pattern);
  prompts 01 (deploy lifecycle in the CLI) and 03 (ergonomic live `HttpClient`)
  improve `transport` ergonomics later but don't gate the DSL.

## Reference

- Low-level primitives: `packages/alchemy/src/{resource,provider,engine}.ts`,
  `packages/algebra/src/{combinators,validate,inspect}.ts`,
  `packages/cli/src/index.ts`, `examples/_shared/src/deploy-service.ts`.
- Worked in-repo flavor: `examples/catalog/src/{schema,project,deploy,api,seed,
diagnostics,deploy-service,connection,workspace-config,cli}.ts`.
- Worked consumer (the shape to derive): `onboarded-schematics/src` +
  `docs/upstream/05-flavor-dsl.md`.
- Runtime surface this plugs into: `SchematicsFlavor` (`@schematics/core`),
  `SchematicsProduct` / `defineSchematicsProduct` (`@schematics/ide`).
