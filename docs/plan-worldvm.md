# Plan: Schematics in WorldVM

Maps Schematics concepts onto WorldVM's kernel, standard library, and
connectors, and proposes how `@worldvm/connector-*` packages relate to
Schematics providers. Status: **proposed**. No package was renamed, moved, or
published. `@worldvm/*` packages do not exist yet, and every API sketch below
is illustrative.

See [Schematics in the WorldVM family](architecture-constellation.md) for the
family roles and the decision to keep Schematics as a named engine.

## Summary

- Schematics stays a standalone engine. It passes the naming test: a platform
  team can use it without the rest of WorldVM.
- Inside WorldVM, Schematics is the reconciliation engine for external
  resources. It computes a **Change** against a system reached through a
  **Connection**, puts it up for review, and applies it.
- `@worldvm/connector-*` packages sit below Schematics. A connector says how to
  reach a system. A Schematics provider says which of that system's resources
  are managed as desired state and how they are edited, identified, ordered,
  planned, and applied.
- Several kernel primitives already exist here in concrete form, mainly
  Connection and Change. This plan records where they fit the canon and where
  they do not.

## Concept mapping

| Schematics concept | In code today                                                                                                                   | WorldVM concept                                              | Owner                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------- |
| Connection options | `DeployConnectionOptions` (environments, auth methods) in `@schematics/protocol`; `defineTokenConnection`                       | Connection                                                   | Connector                                                   |
| Connected account  | `DeployConnection`, `DeployConnectionStore`; credentials as secret-refs in `DeploySecretStore`                                  | Connection instance; the stored credential is a Capability   | Runtime; `enabledKinds` stays in Schematics                 |
| Transport          | `transport(request)`, per-kind `ResourceCrud`, `deriveMockTransport`, `@schematics/alchemy` rate limiter                        | Connection client                                            | Connector                                                   |
| Resource kind      | `defineResource`, `ResourceHandler`                                                                                             | Entity type reachable through a Connection                   | Split: wire schema and CRUD in the connector, the rest here |
| Remote resource    | `RemoteEntity` (`remoteId` + props)                                                                                             | Entity                                                       | External system                                             |
| Observation        | `list` / `read` results and the live wire hash                                                                                  | Fact, observed, with source and time                         | Triplex (planned)                                           |
| Declaration        | A validated document value                                                                                                      | Fact, desired, inside a release                              | Triplex (planned)                                           |
| Release            | Not implemented; planned on Triplex                                                                                             | Triplex release                                              | Triplex                                                     |
| Identity map       | `config.lock.json` (`kind:slug ↔ remoteId`, `appliedHash`)                                                                      | Relation between a declared entity and its external identity | Triplex (planned)                                           |
| Document           | YAML or JSON files routed by `ArtifactProject`                                                                                  | None; an editing projection                                  | Schematics                                                  |
| Plan               | `ConfigPlan`, `ResourceChange` (`before`, `after`, `fields`, `liveHash`)                                                        | Change                                                       | Schematics computes it; the kernel should own the shape     |
| Review             | Plan mode, `propose_patch`, human or agent approval                                                                             | Actor + Policy                                               | Kernel and stdlib                                           |
| Apply              | Dependency-ordered `apply` with an optimistic-concurrency check                                                                 | Change executed through a Connection, run as a Thread        | Schematics                                                  |
| Run records        | Ingest workflow runs under `.schematics/runs/**`; actor, turn, and tool-call trailers on commits in `@schematics/git-artifacts` | Event; provenance facts naming an Actor                      | WorldVM event log (planned); Triplex for provenance         |
| Drift              | Live diff against the lockfile's `appliedHash`                                                                                  | Query over observed vs. declared facts; an Event on drift    | Schematics                                                  |
| Agent tools        | `@schematics/agent` tools scoped to artifact refs                                                                               | Actor + Capability                                           | Schematics today                                            |
| Ingest actions     | `@schematics/ingest` actions (`deterministic`, `model`, `human-gated`; `apply` or `propose`)                                    | Program + Capability + Policy                                | Schematics today; see below                                 |
| Diagnostics        | `SchematicsReflection`                                                                                                          | None                                                         | Schematics                                                  |
| Artifact           | A published output, such as generated HTML                                                                                      | File (stdlib)                                                | Stdlib                                                      |

Provider (`defineProvider`) is not a single WorldVM concept. It bundles a
Connection, a set of entity types, and the reconciliation wiring for them. The
connector proposal below splits it along that line.

## Where the code does not fit the canon cleanly

**`Resource` means two things.** In Schematics, a resource is an object managed
through an external API. The kernel list includes `Resource` without defining
it. If the kernel means an externally managed object, Schematics' resource
model is a direct input to it. If the kernel means a runtime-scoped handle (in
the sense of Effect's `Scope`), the two collide, and Schematics should say
"managed resource" at its public boundary. This should be settled before the
artifact-to-resource vocabulary migration renames anything.

**Schematics' Change is narrower than the kernel's.** `ResourceChange` covers
create, update, delete, and no-op on one external object. A kernel Change also
has to cover fact changes in Triplex and effects summarized from a Program.
Two parts of `ResourceChange` should carry over to the kernel: the field-level
diff, and the basis it was computed against (`liveHash`), which apply
re-checks. Schematics should adopt the kernel Change when it exists, not define
it.

**Connection is generic but named after deploy.** `DeployConnection*`,
`DeployAuthMethod`, and `DeployEnvironment` describe how to reach a system, not
how to deploy to it. `DeployConnection` also carries `enabledKinds`, which is a
Schematics concern mixed into connection identity. This is the most kernel-like
code in the repository.

**`@schematics/ingest` contains a small Program model.** Its actions declare
typed input and output, the capabilities they use, whether they are
deterministic, model-driven, or human-gated, and whether they apply or propose.
That overlaps Program, Capability, and Policy, and also
`@schema-reflection/logic`. It is not worth moving until `@worldvm/program`
exists. New action features should not grow it into a general workflow
language.

**Agent and chat runtime live inside a product.** The OpenRouter proxy, chat
adapter, and tool execution are Actor and Thread concerns. They stay here for
now because nothing else consumes them.

**Several write modes are declared but not implemented.** `ResourceWriteOps`
includes `create-only` and `deprecate`, but only `read-only` changes
reconciler behavior today. Connectors for systems with immutable or
archive-only objects will need the other two.

**Every provider transport is a mock.** The GitHub, Okta, PagerDuty,
Salesforce, Workato, toy, and catalog examples run against derived or
hand-written mocks. No example calls a live API yet. That is the gap a
connector would fill.

## Connectors and providers

A connector is everything about reaching a system. A Schematics provider is
everything about managing part of that system as desired state.

| Concern                                                                | Today                                       | Proposed owner |
| ---------------------------------------------------------------------- | ------------------------------------------- | -------------- |
| Environments and auth methods                                          | `DeployConnectionOptions`                   | Connector      |
| Client from credentials                                                | `defineProvider({ transport })`             | Connector      |
| Account probe                                                          | `defineProvider({ account })`               | Connector      |
| Wire DTO schemas and per-kind list/get/create/update/delete            | `ResourceCrud`, `remote`, `dtoKey`          | Connector      |
| Which mutations the remote supports                                    | `writeOps` (partly)                         | Connector      |
| Rate limits, pagination, retries                                       | `@schematics/alchemy` rate limiter          | Connector      |
| Test transport                                                         | `deriveMockTransport`, `seed`               | Connector      |
| Runtime-only operations (for example, creating a checkout session)     | Not modeled                                 | Connector      |
| Which kinds are managed, and the managed scope `list` must respect     | `defaultKinds`, `enabledKinds`              | Schematics     |
| Document projection (`schemaId`, `route`, `format`, `decode`/`encode`) | `defineResource`                            | Schematics     |
| Human identity (`key`, `slug`, `applySlugToConfig`) and the lockfile   | `defineResource`, `config.lock.json`        | Schematics     |
| Relation annotations and `dependsOn` ordering                          | Schema annotations, `ResourceHandler`       | Schematics     |
| Write policy that narrows what the connector allows                    | `writeOps`                                  | Schematics     |
| Plan, review, apply, drift, journal                                    | `@schematics/alchemy`, `@schematics/deploy` | Schematics     |

Rules:

1. A connector never imports Schematics.
2. `defineProvider` with a hand-written transport stays the primary path. A
   connector is an optional input, so systems without a connector still work
   and Schematics still works without WorldVM.
3. One connector serves many consumers. Schematics reconciles a system's
   configuration. Stdlib packages such as `@worldvm/billing` use the same
   connector for runtime calls that are not desired state.
4. A provider can only narrow what its connector allows, never widen it.

Illustrative sketch. None of these exports exist:

```ts
// @worldvm/connector-stripe (proposed)
export const Stripe = Connector.make({
  id: "stripe",
  environments: [...],          // today: DeployConnectionOptions.environments
  auth: [...],                  // today: DeployConnectionOptions.authMethods
  client: (connection) => ...,  // today: defineProvider({ transport })
  kinds: {
    Product: { schema: ProductDto, operations: { list, get, create, update } },
    Price: { schema: PriceDto, operations: { list, get, create, archive } },
  },
});

// A Schematics provider over the connector (proposed adapter)
import { Stripe } from "@worldvm/connector-stripe";
import { defineProvider, resourceFromConnector } from "@schematics/provider";

export const stripeProvider = defineProvider({
  id: "stripe",
  connector: Stripe,
  resources: [
    resourceFromConnector(Stripe.kinds.Product, {
      schemaId: "Products",
      slug: (product) => product.id,
    }),
    resourceFromConnector(Stripe.kinds.Price, {
      schemaId: "Prices",
      writeOps: "deprecate",
    }),
  ],
});
```

Stripe is the canonical example in the WorldVM note, but Schematics has no
Stripe provider. The first connector should cover a system that already has a
provider here, such as GitHub or PagerDuty. Then the adapter can be checked
against existing plan and apply tests before any new system is added.

## Migration sequence

Each step is proposed. None has been carried out.

1. Docs: adopt WorldVM positioning (this change).
2. Decide what the kernel `Resource` means, before the artifact-to-resource
   vocabulary migration renames public APIs.
3. Decide the npm home for Schematics packages (see open questions). The
   pending `@schematics/alchemy` rename to a reconciliation package should
   target that home instead of being renamed twice.
4. Inside `@schematics/provider`, separate connector-side fields from
   provider-side fields along the table above. Keep `defineProvider` and
   `defineResource` source-compatible. This needs no WorldVM dependency.
5. Rename `DeployConnection*`, `DeployAuthMethod`, and `DeployEnvironment` to
   connection vocabulary in `@schematics/protocol`, keeping the old names as
   aliases. Move `enabledKinds` out of the connection record.
6. Port one example (GitHub or PagerDuty) to the split and add a live transport
   shaped so it can later be moved into a connector unchanged.
7. Implement the `create-only` and `deprecate` write modes.
8. When `@worldvm/core` defines Connection and the connector convention exists,
   build the first connector in the WorldVM repository and add an optional
   `resourceFromConnector` adapter here. Schematics must not take a required
   dependency on `@worldvm/*`.
9. After the Triplex adapter lands (constellation step 5), align
   `ResourceChange` with the kernel Change and record applies as WorldVM
   Events.
10. Revisit `@schematics/ingest` and the agent runtime once
    `@worldvm/program` and `@worldvm/thread` exist.

## Open questions

1. **Kernel `Resource`.** Does it mean an externally managed object, as in
   Schematics, or a runtime-scoped handle? The answer decides whether
   Schematics' resource model feeds the kernel or renames itself.
2. **npm home and name.** `@schematics/angular` is published by the Angular
   team, so the `@schematics` scope is not available for publishing. "Angular
   Schematics" is also a well-known name. Options: publish as
   `@worldvm/schematics` and `@worldvm/schematics-*` while keeping the engine
   name (the WorldVM note lists `@worldvm/triplex` the same way), take a
   different scope, or rename the product.
3. **Connector weight.** Can a connector depend only on Effect and Effect
   Schema, or does it need `@worldvm/core`? If it needs the kernel, Schematics
   users who adopt a connector are also adopting part of WorldVM.
4. **Schema Reflection's role.** Does it stay a neutral standalone library?
   Does `algebra` sit beneath `@worldvm/schema`? `logic` overlaps
   `@worldvm/program` and Runfold, and `predicates` overlaps Policy. Which
   becomes the WorldVM-facing API?
5. **What a WorldVM developer imports.** Is desired-versus-observed
   reconciliation exposed as a stdlib package (for example
   `@worldvm/reconcile`) with Schematics as the engine behind it, the way
   Runfold sits behind `@worldvm/program`? Or is Schematics itself the import?
6. **Ontology direction.** Should Schematics resource kinds be published into
   Open Ontology as entity types, or should Open Ontology define entity types
   that Schematics providers bind to?
