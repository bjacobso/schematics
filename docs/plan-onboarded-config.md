# Plan: Onboarded Configuration Workspaces

Schema IDE should become the shared workspace for authoring, validating,
reviewing, and eventually deploying Onboarded customer configuration as code.

The first customer-shaped proving ground is upstream implementation work:
nested accounts, connected account distribution, customer-specific forms,
policy rules, PDF/document mappings, integration settings, and implementation
manifests. This should not turn Schema IDE into a source converter. It should
make Schema IDE the typed configuration workspace where humans and agents edit
an Onboarded implementation plan under the same contracts that production uses.

## Direction

The core flow is:

```text
customer source material
  -> schema-routed workspace files
  -> schema-algebra relation graph
  -> validation, reflection, and agent tools
  -> generated Onboarded deploy plan
  -> Onboarded API or service adapter
```

Schema IDE owns the editing and validation loop. Schema Algebra owns the
cross-file meaning: which account owns which form, which policy requires which
form, which PDF mapping targets which field, which connected account receives
which distribution, and what breaks when one of those nodes changes.

The first domain package can be called `onboarded-config` until the product
boundary is clearer.

## Current Assets

### Schema IDE

This repository already has the right substrate:

- `@schema-ide/core` provides schema-routed JSON/YAML workspaces, validation,
  diagnostics, reflection, source helpers, and versioned workspace history.
- `@schema-ide/react` provides the reusable IDE surface.
- `@schema-ide/agent` exposes bounded workspace tools for agents.
- `@schema-ide/server` can run as a standalone HTTP service.
- `@schema-ide/schema-algebra` provides relation metadata, graph extraction,
  duplicate ID diagnostics, unresolved reference diagnostics, and scoped refs.

The missing piece is a consumer workspace schema and a thin product wrapper for
Onboarded-specific configuration.

### Source Implementation Repo

An upstream implementation repo can already behave like an
implementation-as-code staging area:

- source artifacts live under `customers/<customer>/...`
- generated artifacts live under `output/<customer>/<form-slug>/...`
- pipeline scripts are Effect-friendly and schema-driven
- `form.yaml` targets Onboarded `FormVersionExport`
- PDF mappings and annotation artifacts sit beside each form output
- the dev UI exposes pipeline status and whitelisted pipeline steps
- customer READMEs capture account, policy, and implementation context

The upstream source workflow should become the first importer and consumer of
the workspace model, not the permanent product boundary.

### Onboarded App

The configuration workspace should compile toward Onboarded's production domain
vocabulary rather than inventing a parallel model:

- organization/account hierarchy, including connected organizations/accounts
- account-scoped business entities such as employees, employers, clients, jobs,
  and placements
- versioned forms through `TaskLineage`, `TaskVersion`, `TaskTemplate`,
  `SubtaskTemplate`, `FieldTemplate`, and `FormVersionExport`
- policies and `PolicyForm` rules
- form subscriptions and form/policy distribution strategies
- public/internal Effect HttpApi schemas
- integration configuration through typed attributes and encrypted credentials

Workspace schemas may add implementation metadata, provenance, review state,
and deploy intent, but production Onboarded schemas remain the contract wherever
they already exist.

## Product Shape

The same workspace schema should work in three modes.

Local CLI:

```sh
onboarded-config validate --dir ./customers/demo-account
onboarded-config graph --dir ./customers/demo-account --json
onboarded-config plan --dir ./customers/demo-account --target test
onboarded-config deploy --dir ./customers/demo-account --target test
```

Hosted workspace service:

```text
browser IDE + agent chat
  -> Schema IDE server
  -> workspace validation and reflection
  -> optional Onboarded API deploy adapter
```

Agent target:

```text
agent reads diagnostics and relation graph
agent edits YAML/JSON files
Schema IDE validates each patch
deploy plan is generated only from valid workspace state
```

PDF support and CLI binaries for specific workspaces are adjacent package
capabilities. They should make this domain easier to ship, but the Onboarded
configuration model should not depend on those PRs being complete before the
schema and relation design can start.

## Workspace Layout

A customer workspace can be a plain directory of routed YAML files:

```text
accounts/
  platform.yaml
  connected/
    demo-account-live.yaml
    demo-account-test.yaml
    partner-account-live.yaml
forms/
  client-safety-packet.yaml
  demo-account-safety-quiz.yaml
policies/
  regional-client-safety.yaml
  pre-assignment-onboarding.yaml
pdf-mappings/
  client-safety-packet.yaml
integrations/
  upstream-source.yaml
  checkr.yaml
distribution/
  forms.yaml
  policies.yaml
imports/
  upstream-source/
    demo-account/
      surveys.yaml
      forms.yaml
```

Initial route set:

| Route | Schema | Purpose |
| --- | --- | --- |
| `accounts/*.yaml`, `accounts/connected/*.yaml` | `AccountConfig` | Platform and connected account identity, hierarchy, mode, branding, contacts, language, and live/test pairing. |
| `forms/*.yaml` | `FormConfig` | Onboarded `FormVersionExport` plus lineage, ownership, provenance, status, and document mapping references. |
| `policies/*.yaml` | `PolicyConfig` | Policy name, lifecycle status, rules, and form memberships. |
| `pdf-mappings/*.yaml` | `PdfMappingConfig` | Mapping from Onboarded field paths to AcroForm fields or screenshot-backed annotation boxes. |
| `integrations/*.yaml` | `IntegrationConfig` | Non-secret typed attributes, secret references, account bindings, and integration app bindings. |
| `distribution/*.yaml` | `DistributionConfig` | Audience, platform strategy, auto-update/delete flags, deployment mode, rollback/removal intent, and connected account results. |
| `imports/**/*.yaml` | `ImportManifest` | Source artifacts and generated outputs from an upstream system. |

The workspace root should be valid without generated output folders. Import
manifests point back to pipeline artifacts; they do not make `output/**` the
long-term source of truth.

## Schema Algebra Role

Schema Algebra should be the semantic layer for this domain, not just a local
shape checker.

Required relationships:

- account files define account IDs and account scopes
- connected accounts reference platform accounts
- forms define lineage/form IDs
- forms define field paths scoped by form
- PDF mappings reference form field paths
- policies reference forms
- policy rules reference placement facts and, where needed, form or account fields
- distribution strategies reference forms, policies, and connected accounts
- integration configs reference accounts and integration identifiers
- import manifests reference generated form, PDF, and mapping artifacts

The existing `Relation.id`, `Relation.ref`, `Relation.refs`, `Relation.parent`,
and scoped reference behavior is enough for the first pass. Onboarded-specific
semantics should layer on top:

- field path lookup within `FormVersionExport`
- policy rule fact/path validation
- account scopes for platform, connected, live, and test hierarchies
- impact analysis such as "what breaks if this form field is renamed?"
- projection from valid workspace state to deploy plan entries
- patch constraints such as "agent may edit forms and mappings but not
  credentials"

This is the difference between a folder of YAML files and a typed implementation
workspace.

## Compilation Boundary

The workspace should compile to explicit deploy artifacts before anything
mutates Onboarded.

```text
workspace files
  -> decode with Effect Schema
  -> build relation graph
  -> run semantic validation
  -> produce deploy plan
  -> apply through Onboarded API/service adapters
```

Deploy plan entries should describe product intent:

- create or update connected organization/account
- create form lineage or draft version
- update form version from `FormVersionExport`
- publish or deploy form version to test or live
- create or update policy
- attach form to policy with rule
- configure form or policy distribution strategy
- create or update integration app attributes or credential references
- upload or associate PDF mappings

The deploy plan must not be raw Prisma/table writes. Keeping the boundary at
Onboarded APIs or service adapters prevents Schema IDE from coupling to internal
storage details.

## Source Adapter Migration Path

Source adapters should feed the workspace in phases:

1. Keep the current pipeline for screenshots, transcripts, structured JSON,
   YAML, PDF, annotations, and mapping artifacts.
2. Generate `forms/*.yaml` from `output/<customer>/<form>/form.yaml` instead
   of treating `output/**` as the final user-facing artifact.
3. Generate `pdf-mappings/*.yaml` from the current PDF mapping and annotation
   outputs.
4. Add customer-level import manifests that connect source forms, generated
   outputs, accounts, and implementation questions from `customers/*/README.md`.
5. Add first policy files for Demo Account and Partner Account from working
   session outputs.
6. Validate the whole customer workspace through Schema IDE.
7. Generate an Onboarded deploy plan for test mode.

An existing source implementation UI can later embed `<SchemaIde />` or hand
off to a hosted Schema IDE service. The first valuable milestone is making the
customer implementation graph visible and valid.

## Agent Contract

Agents should operate against workspace files and Schema IDE tools, not against
the database.

Useful domain-level tools:

- list/read/grep files
- get diagnostics
- get relation graph
- get references for an entity
- explain deploy plan
- propose patch
- apply validated edits
- validate workspace

Questions the workspace should answer:

- Which policies require this form?
- Which connected accounts receive this policy?
- Which PDF mappings reference fields that no longer exist?
- What files must change to add a nested connected account?
- What is the smallest deploy plan for test mode?

## Implementation Phases

### Phase 1: Onboarded Config Schemas

Create a consumer workspace schema that imports or mirrors production Onboarded
Effect schemas where possible, especially `FormVersionExport` and policy `Rule`.

Deliverables:

- `onboarded-config` workspace schema
- sample workspace with two accounts, two forms, one policy, and one PDF mapping
- validation through Schema IDE core/CLI
- relation diagnostics for unresolved forms, accounts, and field paths

### Phase 2: Source Adapter

Turn existing upstream outputs into workspace files.

Deliverables:

- generator from `output/<customer>/<form>/form.yaml` to `forms/*.yaml`
- generator from PDF mapping artifacts to `pdf-mappings/*.yaml`
- customer import manifest generator
- Demo Account or Partner Account sample workspace

### Phase 3: Deploy Plan

Compile valid workspace state into explicit JSON deploy intent.

Deliverables:

- dry-run plan command
- stable deploy plan schema
- workspace-to-plan projection
- target-aware test/live plan mode
- no production mutation

### Phase 4: Hosted IDE

Package the same workspace into the Schema IDE React/server stack.

Deliverables:

- browser workspace editor
- diagnostics and relation graph panel
- deploy plan preview
- agent chat scoped to one workspace

### Phase 5: Controlled Deployment

Apply deploy plans through Onboarded APIs or service adapters.

Deliverables:

- test-mode deployment first
- audit log of applied plan entries
- rollback/removal plan support for distribution strategies
- explicit secret handling through references, not plaintext workspace files

## Package Placement

There are three plausible homes:

1. This Schema IDE repo, as an example or first-party consumer package.
2. A source implementation repo, as a migration consumer while the importer
   stabilizes.
3. The Onboarded monorepo, as an internal deployment tool.

Recommended first step: build a small `onboarded-config` consumer package in
the Schema IDE repo with sample fixtures and no production deploy adapter. That
keeps the schema, relation, and IDE product shape close to Schema IDE while
source adapters remain importers. Once deploy adapters matter, move or mirror
the deployment boundary into the Onboarded monorepo where API/service contracts
live.

## Open Questions

- Which Onboarded APIs are stable enough for deploy plans, and which actions
  need new internal endpoints?
- Should secrets be named references, environment-bound secret store IDs, or
  Onboarded-managed credential prompts?
- What is the minimum policy DSL beyond the existing `Rule` schema?
- Should PDF mappings become first-class Onboarded domain objects before the
  tool deploys them, or remain integration-specific artifacts initially?
- How much of the relation graph should be exposed as MCP/agent tools versus
  Schema IDE-native HTTP tools?
- Should `onboarded-config` remain an example package, or graduate into an
  Onboarded-owned internal tool once deploy is in scope?

## Near-Term Cut

The smallest useful next PR is:

- add `packages/onboarded-config` or `packages/examples/src/onboarded-config`
- define the first routed workspace schema
- add a tiny sample workspace
- annotate account, form, policy, and mapping IDs with Schema Algebra relations
- validate unresolved form/account refs and missing form field paths
- document how upstream output maps into the workspace

That PR would make the implementation graph tangible without waiting for PDF
support, workspace-specific binaries, hosted service work, or production deploy.
