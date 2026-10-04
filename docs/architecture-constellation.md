# Schematics in the WorldVM family

[WorldVM](https://worldvm.com) is a TypeScript runtime and standard library for
software that models the world, reasons about it, and acts on it. WorldVM is the
world. Named projects are replaceable engines inside it. `@worldvm/*` is the
standard library developers actually program against.

The `@worldvm/*` packages are not published yet. Every `@worldvm/*` name in this
repository is proposed.

Schematics is the config-as-code control plane for external APIs and SaaS
resources. Inside WorldVM it is the reconciliation engine for resources that
live outside the world: it answers "What would change?" for an external system
reached through a **Connection**, and applies the answer. It keeps its own
identity because it is useful on its own; see [Why Schematics keeps its
name](#why-schematics-keeps-its-name).

```text
WorldVM                     runtime and @worldvm/* standard library (proposed)
├── Open Ontology           world model                       What exists?
├── Triplex                 temporal fact store               What is/was true?
├── Runfold                 engine behind @worldvm/program    What could happen?
└── Schematics              external-resource reconciliation  What would change?
                            through Connection and @worldvm/connector-* (proposed)

Neutral libraries
└── @schema-reflection/*    algebra, predicates, logic (independent Effect libraries)

Alongside WorldVM
├── Foldworks               UI and tooling, including WorldVM-specific components
└── Forma                   demoted; if proven, compiles to WorldVM Program IR
```

The kernel stays SaaS-agnostic. Schematics providers, resource kinds, plans,
and the GitHub, Okta, PagerDuty, Salesforce, and Workato examples are not
kernel primitives. They are built from Connection, Change, Entity, Fact,
Actor, Capability, Policy, Thread, and Event. The concept-by-concept mapping,
the connector proposal, and the migration sequence are in
[Plan: Schematics in WorldVM](plan-worldvm.md).

## Why Schematics keeps its name

The naming test is whether someone could plausibly say "I use Schematics, but I
don't use WorldVM." A platform team that manages GitHub, identity, or incident
configuration as reviewed code needs providers, typed documents, plans, apply,
and drift detection. It does not need a world model, a temporal fact store, or
a program runtime. That is the Terraform and Alchemy use case, and it stands on
its own.

Schematics is also more than a connector. A connector says how to reach a
system. Schematics adds desired state, human-readable identity, dependency
ordering, semantic plans, review, optimistic-concurrency apply, and an IDE and
agent surface for that loop. Folding it into `@worldvm/connector-*` would
either bloat every connector with reconciliation or leave the reconciliation
loop without a home.

So Schematics stays a named engine, like Triplex. `@worldvm/connector-*`
packages sit below it. Schematics must remain usable without WorldVM.

Two caveats are recorded as open questions in the plan. The `@schematics` npm
scope belongs to Angular (`@schematics/angular`), and "Angular Schematics" is a
well-known name in the JavaScript ecosystem.

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

Triplex, WorldVM's temporal fact store, is the intended durable substrate for
definition revisions, immutable releases, environment channels, observations,
transaction history, and provenance. Schematics and Triplex now share Effect
`4.0.0-rc.112`, so their integration can use shared Effect runtime types.
Serialized contracts remain the boundary for independently deployed services.

## Vocabulary

| Term          | Meaning                                                    |
| ------------- | ---------------------------------------------------------- |
| Resource      | An object managed through an external API                  |
| Resource kind | The schema and lifecycle contract for a class of resources |
| Declaration   | A desired typed resource instance                          |
| Document      | An editable YAML or JSON representation (Forma, if proven) |
| Definition    | A typed semantic object tracked by Triplex                 |
| Release       | An immutable, content-addressed graph of definitions       |
| Observation   | Resource state read from an external system                |
| Plan          | Proposed changes from desired declarations to observations |
| Artifact      | A published output, such as agent-generated HTML           |

Each of these terms maps onto a WorldVM concept in
[Plan: Schematics in WorldVM](plan-worldvm.md#concept-mapping).

`ArtifactProject` and the Git-backed artifact store are transitional APIs. The
resource/document vocabulary should replace them at public product boundaries;
compatibility aliases can remain while existing examples migrate.

## Schema Reflection adoption

Status: `@schema-reflection/algebra`, `predicates`, and `logic` are published on
npm at `0.1.0`. Their source repository is private. Their role under WorldVM
is not decided yet; see the open questions in
[Plan: Schematics in WorldVM](plan-worldvm.md#open-questions).

Schematics consumes `@schema-reflection/algebra@0.1.0` directly from npm. It
replaces the incubating `packages/algebra` copy. Its peer metadata still pins
Effect `4.0.0-beta.68`; the workspace allows the tested `4.0.0-rc.112` pairing
explicitly while that package's peer metadata catches up.

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
tracker publicly reachable. The repository and homepage fields in the npm
manifests point to a private GitHub repository, so they return `404` for anyone
without access. That prevents the Effect community from inspecting source or
reporting issues.

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
- Schematics never requires Forma. Documents are YAML or JSON. If Forma proves
  out, it owns parsing, macros, inference, elaboration, and code generation.
- Foldworks owns reusable UI controls; Schematics owns their resource-aware
  composition.
- Open Ontology, WorldVM's world model, may consume Schematics resource kinds.
  Schematics never depends on Open Ontology.
- Schematics stays usable without WorldVM. `@worldvm/*` packages, once they
  exist, enter only through optional adapters.
- `@worldvm/connector-*` packages never depend on Schematics.

## Migration sequence

1. Consume the published algebra package and remove the local fork.
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

The WorldVM-specific sequence (connector split, Connection vocabulary, and
binding plans to a kernel Change) is in
[Plan: Schematics in WorldVM](plan-worldvm.md#migration-sequence).
