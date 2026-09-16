# Schematics in the constellation

Schematics is the config-as-code control plane in a constellation of independent
Effect libraries and products. It consumes the shared primitives; it does not
own them.

```text
Library primitives
├── @schema-reflection/algebra      schema/value structure and relations
├── @schema-reflection/predicates   immutable conditions and interpretation
└── @schema-reflection/logic        executable behavior definitions

Engines and toolkits
├── Forma            language source to typed definitions
├── Triplex          facts, definition releases, history, and provenance
└── Foldworks        reusable application interaction primitives

Products
├── Schematics       external-resource config-as-code control plane
└── Open Ontology    operational workflow platform
```

## Schematics responsibility

Schematics turns an external API into a typed, reviewable control surface:

```text
provider observes remote resources
  -> documents declare desired resources
  -> definition release identifies the desired graph
  -> planner compares declarations with observations
  -> @schema-reflection/algebra exposes the relation graph
  -> the Schematics planner validates and orders resource changes
  -> a human or agent reviews the plan
  -> provider applies it with optimistic concurrency
  -> the journal records provenance and fresh observations
```

Schematics owns provider integration, document projection, desired-versus-
observed planning, review, apply, drift detection, and the agent/UI surfaces for
that lifecycle.

Triplex is the durable substrate for definition revisions, immutable releases,
environment channels, observations, transaction history, and provenance. The
`@schematics/triplex` adapter exposes that substrate as an Effect service and
keeps provider and document concerns out of Triplex. Schematics and Triplex
share Effect `4.0.0-rc.112`, so the adapter can use shared Effect runtime types;
serialized contracts remain the boundary for independently deployed services.

The standalone `apps/ide` workbench is a Foldkit model/update/view application.
Its side effects are Foldkit commands backed by Effect services; its reusable
controls and design tokens come from Foldworks. It currently uses the adapter's
in-memory Triplex layer in the browser, while the same service layer accepts a
durable Triplex `Triples` backend for a server deployment.

## Vocabulary

| Term          | Meaning                                                    |
| ------------- | ---------------------------------------------------------- |
| Resource      | An object managed through an external API                  |
| Resource kind | The schema and lifecycle contract for a class of resources |
| Declaration   | A desired typed resource instance                          |
| Document      | An editable YAML, JSON, or Forma representation            |
| Definition    | A typed semantic object tracked by Triplex                 |
| Release       | An immutable, content-addressed graph of definitions       |
| Observation   | Resource state read from an external system                |
| Plan          | Proposed changes from desired declarations to observations |
| Artifact      | A published output, such as agent-generated HTML           |

`ArtifactProject` and the Git-backed artifact store are transitional APIs. The
resource/document vocabulary should replace them at public product boundaries;
compatibility aliases can remain while existing examples migrate.

## Schema Reflection adoption

Schematics consumes `@schema-reflection/algebra@0.1.0` directly from npm and has
upgraded to Effect `4.0.0-rc.112` for compatibility with Triplex, Foldkit, and
Foldworks, replacing the incubating `packages/algebra` copy. The algebra package
still declares an exact `4.0.0-beta.68` peer; the workspace allows the tested RC
pairing explicitly, but that peer contract must be aligned upstream before the
boundary is considered stable.

`@schema-reflection/predicates@0.1.0` and
`@schema-reflection/logic@0.1.0` currently require Effect `4.0.0-rc.113`.
Schematics should adopt them after its Effect upgrade and only where a product
feature needs them:

- predicates for declarative policy, selection, and plan-approval conditions;
- logic for inspectable workflows or resource behavior;
- Schematics adapters for provider calls, credentials, authorization, and
  plan/apply semantics.

Do not duplicate these libraries locally or add them as unused dependencies.
The earlier Datalog/query experiment is not the same abstraction as the
published logic package. If relational queries become a proven shared need,
incubate them upstream as a separate query package or explicit logic submodule.

## What Schematics should upstream

Before API work, make the Schema Reflection source, documentation, and issue
tracker URLs in the npm manifests publicly reachable. They currently point to
`github.com/bjacobso/schema-reflection`, which returns `404` without repository
access. That prevents the Effect community from inspecting source or reporting
issues.

Publish all three packages against one tested Effect version. Algebra currently
peers on `4.0.0-beta.68`, while predicates and logic peer on
`4.0.0-rc.113`; consumers cannot safely compose them as one Effect runtime.

The published algebra implementation matches the former Schematics package
except for the following migration improvement:

1. Change the canonical relation annotation key from
   `@schematics/algebra/relation` to
   `@schema-reflection/algebra/relation`.
2. Export the old key as `LegacyRelationAnnotationKey` and make annotation
   readers accept both keys so stored schemas and mixed-version consumers remain
   readable.
3. Add a compatibility test before releasing the change.

Future upstream proposals should stay product-neutral:

- algebra: AST traversal, stable fingerprints, paths, diffs, patches, and
  relation-graph visitors;
- predicates: schema-reflectable condition languages and pure interpreters;
- logic: a pure AST fold/visitor that can summarize reads, writes, and emitted
  events before execution, plus opt-in transaction/dry-run hooks.

Provider clients, credentials, authorization, remote identity, plan rendering,
and apply orchestration remain in Schematics. Schematics can translate a neutral
logic capability summary into a resource plan without teaching Schema
Reflection about SaaS APIs.

Do not broaden the packages' Effect peer ranges without testing each supported
Effect release. Their current beta/RC split is evidence that nominally nearby
Effect 4 builds are not yet one runtime boundary.

## Dependency rules

- `@schema-reflection/*` libraries remain independent of Schematics products.
- Triplex does not know about providers, SaaS APIs, credentials, or plan/apply.
- Schematics does not implement a second durable definition graph or journal.
- Forma owns parsing, macros, inference, elaboration, and code generation.
- Foldworks owns reusable UI controls; Schematics owns their resource-aware
  composition.
- Open Ontology may consume Schematics but Schematics never depends on Open
  Ontology.

## Migration sequence

1. Consume the published algebra package and remove the local fork.
2. Upstream the annotation-key compatibility change.
3. Align Schematics, Triplex, Foldkit, and Foldworks on a common Effect 4 release;
   finish by publishing Schema Reflection with the same peer.
4. Adopt predicates and logic through Schematics-owned adapters when concrete
   features require them.
5. Expand the Triplex-backed declaration release/observation adapter from the
   implemented vertical slice to a durable server layer.
6. Make the provider planner bind every plan to a desired release and observed
   basis.
7. Replace public artifact terminology with resources, declarations, documents,
   and observations.
8. Continue moving the remaining React-only product panels onto Foldworks; keep
   the implemented Foldkit workbench as the thin Schematics composition layer.
