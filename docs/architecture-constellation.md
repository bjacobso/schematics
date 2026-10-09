# Schematics in the constellation

Schematics is the config-as-code control plane in a constellation of independent
Effect libraries and products. It consumes the shared primitives; it does not
own them.

```text
Library primitives
├── @schema-reflection/core         portable contracts and expressions (experimental)
├── @schema-reflection/algebra      schema/value structure and relations
├── @schema-reflection/predicates   immutable conditions and interpretation
├── @schema-reflection/logic        inspectable behavior definitions
├── @schema-reflection/workflow     sequential checkpoint prototype
└── @schema-reflection/filesystem   directory contracts (specification/type stub)

Engines and toolkits
├── Forma            language source to typed definitions
├── Triplex          facts, definition releases, history, and provenance
└── Foldworks        reusable application interaction primitives

Products
├── WorldVM          operational worlds and durable Program execution
├── Schematics       external-resource config-as-code control plane
└── Open Ontology    operational workflow platform
```

## Schematics responsibility

Schematics turns an external API into a typed, reviewable control surface. The
target lifecycle below includes planned definition releases and durable journals;
today the provider loop uses documents, observations, plans, and a lockfile:

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

Triplex is the intended durable substrate for definition revisions, immutable
releases, environment channels, observations, transaction history, and
provenance. Schematics and Triplex now share Effect `4.0.0-rc.112`, so their
integration can use shared Effect runtime types. Serialized contracts remain the
boundary for independently deployed services. No Triplex persistence adapter is
shipped in Schematics yet.

## WorldVM boundary

WorldVM owns operational worlds: goals, permissions, work reconciliation, and
durable execution. Its `@worldvm/program` kernel represents computation as a
typed `Program<A, E, R>` with builders, codecs, analysis, and an interpreter.
The WorldVM host enforces authority and stores execution state in Triplex.

Schematics owns desired-versus-observed reconciliation for external resources.
A future WorldVM host could use Schematics capabilities to inspect, plan, and
apply external configuration. This is an integration direction, not an adapter
shipped by either product here.

Schema Reflection logic is neutral inspectable behavior, and its workflow
package is a sequential checkpoint prototype. WorldVM uses its own Program
kernel for new execution; Schema Reflection workflow remains only for legacy
company-v1 compatibility there. Schematics should not build a second durable
execution engine around that prototype.

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

Schematics consumes `@schema-reflection/algebra@0.1.0` directly from npm. It
replaces the incubating `packages/algebra` copy. Its peer metadata still pins
Effect `4.0.0-beta.68`; the workspace allows the tested `4.0.0-rc.112` pairing
explicitly while that package's peer metadata catches up.

The Schema Reflection source workspace has moved to Effect `4.0.0-rc.115`,
while Schematics remains on `4.0.0-rc.112`. Source APIs and published `0.1.0`
packages are separate adoption targets; a source manifest does not establish
the API or peer metadata of an npm release. Test the selected package versions
and their full dependency closure against a compatible Effect release before
adopting them, and only where a product feature needs them:

- predicates for declarative policy, selection, and plan-approval conditions;
- logic for inspectable workflows or resource behavior;
- Schematics adapters for provider calls, credentials, authorization, and
  plan/apply semantics.

Core supplies experimental portable schema contracts and expressions. It is
distinct from `@schematics/core`, the document runtime. Workflow supplies pure
sequential checkpoint transitions; storage, dispatch, and execution services
remain host responsibilities. Filesystem has only a specification and type
stub today. Its proposed neutral routing and cross-file validation could absorb
reusable document primitives later, while `ArtifactProject` remains the shipped
Schematics contract.

The public site introduces all six libraries through static guides and
Foldkit/Foldworks simulations. Featuring a library does not make it a runtime
dependency: only algebra is consumed by Schematics today.

Do not duplicate these libraries locally or add them as unused dependencies.
The earlier Datalog/query experiment is not the same abstraction as the
published logic package. If relational queries become a proven shared need,
incubate them upstream as a separate query package or explicit logic submodule.

## What Schematics should upstream

Keep public source, documentation, and issue-tracker links reachable for library
consumers. Publish composable packages against a tested common Effect version;
the beta peer metadata in Schematics' locked algebra release differs from the
newer source workspace's RC pin.

The locked algebra release still uses the Schematics relation annotation key.
The proposed upstream compatibility change is:

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
  events before execution, plus opt-in transaction/dry-run hooks;
- filesystem: neutral document routing, codecs, source maps, and cross-file
  validation as its proposed runtime is implemented.

Provider clients, credentials, authorization, remote identity, plan rendering,
and apply orchestration remain in Schematics. Schematics can translate a neutral
logic capability summary into a resource plan without teaching Schema
Reflection about SaaS APIs.

Do not broaden the packages' Effect peer ranges without testing each supported
Effect release. A beta or RC number alone does not establish runtime
compatibility. WorldVM tests a selected Schema Reflection slice on RC.112;
that does not validate every upstream feature for Schematics.

## Dependency rules

- `@schema-reflection/*` libraries remain independent of Schematics products.
- Triplex does not know about providers, SaaS APIs, credentials, or plan/apply.
- Schematics does not implement a second durable definition graph or journal.
- WorldVM owns durable Program execution; Schematics exposes resource-management
  capabilities for a future host adapter.
- Forma owns parsing, macros, inference, elaboration, and code generation.
- Foldworks owns reusable UI controls; Schematics owns their resource-aware
  composition.
- Open Ontology may consume Schematics but Schematics never depends on Open
  Ontology.

## Migration sequence

The published algebra dependency has replaced the local fork. Remaining work:

1. Keep neutral library improvements upstream in Schema Reflection.
2. Upstream the annotation-key compatibility change.
3. Align Schematics, Schema Reflection, Triplex, and Foldworks on a common Effect
   4 release.
4. Adopt predicates and logic through Schematics-owned adapters when concrete
   features require them.
5. Add a Triplex-backed definition/release/observation adapter.
6. Make the provider planner bind every plan to a desired release and observed
   basis.
7. Replace public artifact terminology with resources, declarations, documents,
   and observations.
8. Move reusable UI into Foldworks and retain a thin Schematics control-plane
   application.
