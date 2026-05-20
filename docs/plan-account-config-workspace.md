# Plan: Single Account Configuration Workspace

This is the simpler first version of `onboarded-config`: one folder represents
one Onboarded account or subaccount. The workspace is optimized for human review,
agent edits, and Schema IDE validation. It is not a one-to-one mirror of
Onboarded tables. It is an ergonomic source model that can compile back to
Onboarded forms, attributes, policies, and automations.

## Goal

Make a single account implementation reviewable as YAML:

```text
account workspace
  -> high-level account config
  -> custom and system attribute catalog
  -> forms and compliance-library form links
  -> policies and rules
  -> automations
  -> schema validation + relation diagnostics
  -> deploy-plan projection
```

The MVP should answer:

- Does every form reference valid custom/system attributes?
- Does every form field path follow Onboarded path conventions?
- Does every field rule reference valid attributes or fields?
- Does every policy rule reference valid system/custom attributes?
- Does every policy attach valid local forms or form subscriptions?
- Does every automation rule/action reference valid attributes and forms?
- What deploy-plan intent would this workspace produce?

## Workspace Boundary

One folder equals one account/subaccount. Nested account relationships,
connected-account distribution, live/test pairing, and cross-account propagation
are intentionally deferred.

```text
demo-account-test/
  account.yaml
  attributes.yaml
  forms/
    client-safety-packet.yaml
    demo-account-safety-quiz.yaml
    library/
      standard-tax-withholding.yaml
      regional-withholding.yaml
  policies/
    client-site-onboarding.yaml
  automations/
    remind-expiring-task.yaml
  imports/
    upstream-source.yaml
```

The workspace can later be nested under a customer repo path such as:

```text
customers/demo-account/workspace/
```

but Schema IDE should only care about the workspace root.

## Design Principles

- Prefer small YAML files with stable IDs over generated JSON blobs.
- Keep authoring names domain-friendly: `forms`, `attributes`, `policies`,
  `automations`.
- Keep references explicit and string-based so humans can review diffs.
- Use Onboarded field paths as the common reference language:
  `employee.custom_attributes.badge_number`, `placement.branch_code`,
  `form.custom_attributes.quiz_score`, `form.signature`.
- Use production Onboarded schemas where they are already portable:
  `Rule`, `FormVersionExport`, and `AutomationExport`.
- Wrap production schemas with workspace metadata instead of exposing raw deploy
  payloads as the top-level authoring shape.
- Allow generated upstream-source forms to be copied in without demanding perfect
  hand-authored YAML on day one.

## Route Set

| Route | Schema | Source role |
| --- | --- | --- |
| `account.yaml` | `AccountConfig` | Account identity, mode, metadata, and deploy defaults. |
| `attributes.yaml` | `AttributeCatalog` | Custom and system attribute definitions for this account. |
| `forms/*.yaml` | `FormConfig` | Local forms, source provenance, and form version export. |
| `forms/library/*.yaml` | `FormSubscription` | Account subscription to a compliance-library/global form. |
| `policies/*.yaml` | `PolicyConfig` | Policy membership, form requirements, and rule trees. |
| `automations/*.yaml` | `AutomationConfig` | Ergonomic automation wrapper around trigger, conditions, and actions. |
| `imports/*.yaml` | `ImportManifest` | Upstream source mapping into this workspace. |

## Path Model

Use one canonical path format everywhere:

```text
<entity>.<property>
<entity>.custom_attributes.<attribute_key>
form.<field_key>
form.custom_attributes.<attribute_key>
```

Allowed entities:

```text
employee
employer
placement
client
job
form
task
```

Custom attributes are declared in `attributes.yaml`. System attributes are also
declared there for workspace validation, even if Onboarded already knows about
the production field.

Examples:

```yaml
employee.custom_attributes.badge_number
placement.custom_attributes.branch
client.customer_number
job.custom_attributes.department_code
form.key_things_employee_signature
form.custom_attributes.safety_quiz_score
task.status
```

MVP validation should treat unknown system paths as errors unless they appear in
`attributes.yaml`. That makes the workspace self-contained and reviewable.

## YAML Shapes

### `account.yaml`

```yaml
id: demo-account-test
name: Demo Staffing Test Account
mode: test
timezone: America/Chicago
language: en
source:
  system: upstream-source
  customer: demo-account
deploy:
  defaultTarget: test
  forms:
    publish: false
  policies:
    status: draft
```

Schema notes:

- `id` defines `Account`.
- `mode` is `test | live | sandbox`.
- `source` is provenance only.
- `deploy` controls plan defaults, not direct mutation.

### `attributes.yaml`

```yaml
custom:
  employee:
    - key: badge_number
      label: Badge Number
      type: string
      required: false
      status: active
  placement:
    - key: branch
      label: Branch
      type: string
      status: active
  form:
    - key: safety_quiz_score
      label: Safety Quiz Score
      type: integer
      status: active

system:
  employee:
    - key: social_security_number
      label: Social Security Number
      type: string
      sensitive: true
    - key: date_of_birth
      label: Date of Birth
      type: date
  placement:
    - key: start_date
      label: Start Date
      type: date
    - key: branch_code
      label: Branch Code
      type: string
```

Derived paths:

- custom employee `badge_number` defines
  `employee.custom_attributes.badge_number`
- system employee `date_of_birth` defines `employee.date_of_birth`
- custom form `safety_quiz_score` defines
  `form.custom_attributes.safety_quiz_score`

MVP scalar types should match Onboarded's supported custom attribute types:

```text
string | boolean | date | datetime | integer | decimal | address
```

System attribute values can use the same scalar set for now. If a production
field later has a more specific schema, the compiler can refine it.

### `forms/library/*.yaml`

```yaml
id: standard-tax-withholding
name: Standard Tax Withholding
status: active
source:
  registry: forms.example/library
  kind: compliance-form
  slug: standard-tax-withholding
  version: "2026.1"
libraryForm:
  externalId: global:standard-tax-withholding
  canonicalPath: /forms/example/standard-tax-withholding
subscription:
  autoUpdate: true
  mode: required
deploy:
  target: test
```

`FormSubscription` files define form IDs in the same policy-reference namespace
as local `FormConfig` files, but they do not contain `FormVersionExport`. They
represent account intent to use an existing library/global form. The `source`
block should be explicit enough for a human, agent, and deploy adapter to know
which registry the form came from and which version is intended.

`source.registry` should be a stable origin such as `forms.example/library`.
`source.slug` is the human-readable library key. `source.version` can be a
pinned version such as `"2026.1"` or a channel such as `latest`; deploy plans
should preserve whether the subscription is pinned or floating.

Policies can reference local forms or subscribed library forms through the same
`form` key. The compiler decides whether a form reference maps to a local form
version upsert or an account form subscription.

Optional future fields:

```yaml
overrides:
  displayName: Standard Tax Withholding
  dueInDays: 7
  assignee: employee
```

Keep overrides intentionally small. If an account needs to materially change a
library form, it should become a local `forms/*.yaml` form instead of a
subscription.

### `forms/*.yaml`

```yaml
id: client-safety-packet
name: Client Safety Packet
status: draft
owner: account
source:
  system: upstream-source
  formId: "42350"
  output: ../../output/demo-account/ar-client-safety-packet/form.yaml
references:
  attributes:
    - employee.custom_attributes.badge_number
    - placement.branch_code
version:
  name: Client Safety Packet
  description: Client safety packet.
  pages:
    - description: Cell Phone Policy
      assignee: employee
      fields:
        - path: form.cell_phone_policy_content
          type: content
          required: false
          rule: null
          options: null
          translations:
            en:
              content: |
                ## Cell Phone Policy
                Cell phones are not permitted on the production floor.
        - path: form.cell_phone_signature
          type: signature
          required: true
          rule: null
          options: null
          translations:
            en:
              label: Employee Signature
```

Schema notes:

- `id` defines `Form`.
- `references.attributes` is optional. It gives humans a short review list and
  gives agents a place to add intent before all references are discoverable
  from fields/rules.
- `version` should initially be the imported or copied `FormVersionExport`
  schema from Onboarded.
- Every field `path` defines a form-scoped field path.
- Every field rule condition should be traversed and validated against known
  attribute/form paths.

### `policies/*.yaml`

```yaml
id: client-site-onboarding
name: Client Site Onboarding
status: draft
appliesTo: placement
description: Required before matching client-site assignments.
when:
  all:
    - fact: client.customer_number
      operator: equal
      value: client-site
    - fact: placement.branch_code
      operator: equal
      value: north-branch
requires:
  forms:
    - form: client-safety-packet
      required: true
    - form: standard-tax-withholding
      required: true
```

Schema notes:

- `id` defines `Policy`.
- `when` should use the production Onboarded `Rule` tree.
- `requires.forms[].form` references a local form or form subscription.
- Policy fact paths are validated against `attributes.yaml` plus known
  task/form fields when appropriate.

### `automations/*.yaml`

Use a simplified authoring model first, then compile to Onboarded
`AutomationExport`.

```yaml
id: remind-expiring-client-site-task
name: Remind assignee before client-site task expires
status: draft
trigger:
  entity: task
  on: updated
  properties:
    - due_at
when:
  all:
    - fact: task.status
      operator: equal
      value: assigned
    - fact: task.form
      operator: equal
      value: client-safety-packet
steps:
  - id: wait-until-one-day-before-due
    type: wait
    until:
      fact: task.due_at
      offset:
        amount: -1
        unit: day
  - id: send-reminder
    type: send_email
    to: employee
    template: client-site-task-reminder
```

Schema notes:

- `id` defines `Automation`.
- `when` uses the same `Rule` tree.
- `trigger.properties` must be valid properties for the trigger entity.
- Action step refs must be valid for the action type.
- MVP can support `wait`, `send_email`, `assign_task`, `create_task`, and
  `set_task_expiration`, then lower them into production `AutomationExport`
  nodes/edges.

### `imports/*.yaml`

```yaml
source: upstream-source
customer: demo-account
forms:
  - workspaceForm: client-safety-packet
    sourceFormId: "42350"
    sourceHtml: ../../customers/demo-account/forms/client-safety-packet
    generatedFormYaml: ../../output/demo-account/ar-client-safety-packet/form.yaml
    generatedPdf: ../../output/demo-account/ar-client-safety-packet/annotation/annotated.pdf
```

Imports should never be required for workspace validity. They are provenance and
regeneration hints.

## Effect Schema Plan

Create a package or example module with this rough shape:

```text
packages/onboarded-config/
  src/
    index.ts
    schemas/
      account.ts
      attributes.ts
      rules.ts
      forms.ts
      policies.ts
      automations.ts
      imports.ts
      workspace.ts
    validation/
      paths.ts
      relations.ts
      field-paths.ts
      deploy-plan.ts
    examples/
      demo-account-test/
        account.yaml
        attributes.yaml
        forms/client-safety-packet.yaml
        forms/library/standard-tax-withholding.yaml
        policies/client-site-onboarding.yaml
        automations/remind-expiring-task.yaml
```

If the package boundary is too much for the first patch, put this under
`packages/examples/src/onboarded-config/` and promote it later.

### Schema Imports and Inline Copies

Prefer importing these from Onboarded when the package lives in a repo that can
depend on Onboarded:

- `Rule` from `packages/domain/src/shared/schemas/Rule.ts`
- `FormVersionExport` from
  `packages/domain/src/internal/resources/FormVersionsApi.ts`
- `AutomationExport` from
  `packages/domain/src/internal/resources/AutomationsApi.ts`

For a standalone Schema IDE example, copy and inline the small stable pieces:

- `RuleOperator`, `RuleCondition`, `RuleAll`, `RuleAny`, `Rule`
- supported scalar/entity/custom attribute constants
- a reduced `FormVersionExport` surface if importing `TypedFormField` is too
  heavy
- a simplified automation authoring schema, with production `AutomationExport`
  only used at the compile boundary

Do not copy Prisma models or table-shaped schemas into this package.

### Core Schemas

High-level shape:

```ts
const Entity = Schema.Literal(
  "employee",
  "employer",
  "placement",
  "client",
  "job",
  "form",
  "task",
);

const ScalarType = Schema.Literal(
  "string",
  "boolean",
  "date",
  "datetime",
  "integer",
  "decimal",
  "address",
);

const AttributeDefinition = Schema.Struct({
  key: Relation.id("AttributeKey", { display: "label" }),
  label: Schema.String,
  type: ScalarType,
  required: Schema.optional(Schema.Boolean),
  status: Schema.optional(Schema.Literal("active", "deprecated")),
  sensitive: Schema.optional(Schema.Boolean),
});

const FormConfig = Schema.Struct({
  id: Relation.id("Form", { display: "name" }),
  name: Schema.String,
  status: Schema.Literal("draft", "published", "deprecated"),
  owner: Schema.optional(Schema.Literal("account", "library")),
  source: Schema.optional(SourceMetadata),
  references: Schema.optional(
    Schema.Struct({
      attributes: Schema.optional(Schema.Array(Relation.ref("AttributePath"))),
    }),
  ),
  version: FormVersionExport,
});

const FormSubscription = Schema.Struct({
  id: Relation.id("Form", { display: "name" }),
  name: Schema.String,
  status: Schema.Literal("active", "paused", "deprecated"),
  source: Schema.Struct({
    registry: Schema.String,
    kind: Schema.Literal("compliance-form", "system-form"),
    slug: Schema.String,
    version: Schema.String,
  }),
  libraryForm: Schema.Struct({
    externalId: Schema.String,
    canonicalPath: Schema.optional(Schema.String),
  }),
  subscription: Schema.Struct({
    autoUpdate: Schema.Boolean,
    mode: Schema.Literal("required", "available"),
  }),
  overrides: Schema.optional(
    Schema.Struct({
      displayName: Schema.optional(Schema.String),
      dueInDays: Schema.optional(Schema.Number),
      assignee: Schema.optional(Schema.Literal("employee", "employer", "system")),
    }),
  ),
});

const PolicyConfig = Schema.Struct({
  id: Relation.id("Policy", { display: "name" }),
  name: Schema.String,
  status: Schema.Literal("draft", "active", "deprecated"),
  appliesTo: Schema.Literal("employee", "placement", "client", "job"),
  description: Schema.optional(Schema.String),
  when: Rule,
  requires: Schema.Struct({
    forms: Schema.Array(
      Schema.Struct({
        form: Relation.ref("Form"),
        required: Schema.optional(Schema.Boolean),
        when: Schema.optional(Rule),
      }),
    ),
  }),
});
```

`AttributePath` probably should not be authored as a separate file node.
Instead, build relation definitions during workspace validation from the
attribute catalog:

```text
custom.employee.badge_number -> employee.custom_attributes.badge_number
system.employee.date_of_birth -> employee.date_of_birth
```

If Schema Algebra needs schema-native definitions only, add a derived
`attributePaths` collection in the workspace transform before relation
validation.

## Workspace Schema

Use `Workspace.Struct` to route files:

```ts
export const AccountWorkspace = Workspace.Struct({
  account: Workspace.file("account.yaml", AccountConfig),
  attributes: Workspace.file("attributes.yaml", AttributeCatalog),
  forms: Workspace.files("forms/*.yaml", FormConfig).pipe(
    Workspace.indexBy("id"),
    Workspace.annotations({ identifier: "Forms" }),
  ),
  formSubscriptions: Workspace.files("forms/library/*.yaml", FormSubscription).pipe(
    Workspace.indexBy("id"),
    Workspace.annotations({ identifier: "FormSubscriptions" }),
  ),
  policies: Workspace.files("policies/*.yaml", PolicyConfig).pipe(
    Workspace.indexBy("id"),
    Workspace.annotations({ identifier: "Policies" }),
  ),
  automations: Workspace.files("automations/*.yaml", AutomationConfig).pipe(
    Workspace.indexBy("id"),
    Workspace.annotations({ identifier: "Automations" }),
  ),
  imports: Workspace.files("imports/*.yaml", ImportManifest),
}).pipe(
  Workspace.validate("onboarded-config-paths", validateWorkspacePaths),
  Workspace.validate("onboarded-config-rules", validateRuleFacts),
  Workspace.validate("onboarded-config-forms", validateFormFields),
  Workspace.validate("onboarded-config-automations", validateAutomations),
);
```

If `Workspace.file` does not exist yet, model singleton files with
`Workspace.files("account.yaml", ...)` and enforce exactly one match in a
workspace validator.

## Validation Rules

### Attribute Catalog

- custom attribute keys must be unique per entity
- system attribute keys must be unique per entity
- custom and system derived paths must not collide
- `form` custom attributes are allowed only in `custom.form`, not `system.form`
- scalar type must be one of the supported Onboarded scalar types
- deprecated attributes may be referenced only with a warning in MVP

### Form Validation

- each local form `id` is unique
- each form subscription `id` is unique
- local forms and form subscriptions share one `Form` relation namespace
- a path must not exist as both `forms/<id>.yaml` and
  `forms/library/<id>.yaml`
- every field `path` is unique inside the form
- every field path starts with `form.`
- every field rule fact references either:
  - a known attribute path
  - a field path in the same form
  - an allowed task path such as `task.status`, if the field rule surface allows it
- every explicit `references.attributes[]` entry exists
- every discovered attribute reference should be present in the diagnostics or
  reflection graph even if not listed manually

### Policy Validation

- every `requires.forms[].form` resolves to a local form or form subscription
- every `when` fact resolves to a known attribute/system path or allowed task path
- every per-form requirement `when` fact resolves with the same rule rules
- operators are compatible with the referenced scalar type:
  - `contains` / `doesNotContain` need array-like values or are warnings until
    list types exist
  - numeric comparisons require `integer` or `decimal`
  - date comparisons require `date` or `datetime`

### Automation Validation

- every automation `id` is unique
- trigger entity is one of the supported automation entities for the MVP
- trigger properties are valid for that entity
- `when` rule facts resolve to known paths
- action step IDs are unique inside the automation
- action references to forms, policies, templates, or attributes resolve
- wait steps must have a valid fact path and supported time unit
- the compiler can lower all steps into a production automation plan, or else
  diagnostics include `unsupported-automation-step`

## Relation Graph

Initial relation node types:

```text
Account
AttributePath
Form
FormSubscription
FormField
Policy
Automation
AutomationStep
ImportArtifact
```

Initial edges:

```text
Form -> AttributePath
FormField -> AttributePath
Policy -> Form
Policy -> FormSubscription
Policy -> AttributePath
Automation -> AttributePath
Automation -> Form
Automation -> AutomationStep
ImportArtifact -> Form
```

This enables Schema IDE and agents to answer:

- "Where is `placement.branch_code` used?"
- "Which policies require `client-safety-packet`?"
- "Which automations depend on `task.due_at`?"
- "Which form rules reference deprecated attributes?"
- "What breaks if `employee.custom_attributes.badge_number` is renamed?"

## Compiler Plan

The compiler should produce a deploy plan, not mutate Onboarded:

```json
{
  "workspace": "demo-account-test",
  "target": "test",
  "entries": [
    {
      "type": "upsert_custom_attribute",
      "path": "employee.custom_attributes.badge_number",
      "label": "Badge Number",
      "scalarType": "string"
    },
    {
      "type": "upsert_form_version",
      "form": "client-safety-packet",
      "payload": "FormVersionExport"
    },
    {
      "type": "upsert_policy",
      "policy": "client-site-onboarding"
    },
    {
      "type": "attach_policy_form",
      "policy": "client-site-onboarding",
      "form": "client-safety-packet"
    }
  ]
}
```

Projection rules:

- `attributes.yaml` -> custom/system property upserts or checks
- `forms/*.yaml` -> form lineage/version create-or-update intent
- `forms/library/*.yaml` -> form subscription upsert or lookup requirement, not
  local form creation
- `policies/*.yaml` -> policy create/update plus policy-form attachment
- `automations/*.yaml` -> automation create/update from compiled export
- `imports/*.yaml` -> provenance only, unless a generator command asks to sync
  from source artifacts

## CLI Commands

Target commands for the account workspace:

```sh
onboarded-config validate --dir ./customers/demo-account/workspace
onboarded-config graph --dir ./customers/demo-account/workspace --json
onboarded-config explain --dir ./customers/demo-account/workspace placement.branch_code
onboarded-config plan --dir ./customers/demo-account/workspace --target test
onboarded-config import-source --dir ./customers/demo-account/workspace --output ./output/demo-account
```

MVP can use the generic Schema IDE CLI validation if the domain package exports
the workspace schema. The custom commands can come after the schema and
validators are stable.

## Implementation Phases

### Phase 1: Schema MVP

Deliverables:

- `AccountConfig`, `AttributeCatalog`, `FormConfig`, `FormSubscription`,
  `PolicyConfig`, `AutomationConfig`, and `ImportManifest`
- one `AccountWorkspace` route schema
- one sample workspace with account, attributes, two local forms, one form
  subscription, one policy, and one automation
- copied inline `Rule` schema if importing Onboarded is too heavy
- `FormVersionExport` imported when available, reduced local fallback otherwise

### Phase 2: Semantic Validators

Deliverables:

- derived attribute path registry
- form field path extraction
- rule fact extraction for form rules, policies, and automations
- unresolved reference diagnostics with file/path locations
- scalar/operator compatibility diagnostics
- duplicate ID/path diagnostics

### Phase 3: Relation Graph Integration

Deliverables:

- Schema Algebra relation annotations for direct IDs/refs
- derived relation graph entries for attribute paths and form fields
- reverse-reference queries for attributes, forms, policies, and automations
- graph JSON command or reflection panel data

### Phase 4: Source Importer

Deliverables:

- copy or transform `output/<customer>/<form>/form.yaml` into `forms/*.yaml`
- create `imports/upstream-source.yaml`
- optionally infer initial `attributes.yaml` entries from discovered field/rule
  paths
- produce warnings for paths that need human classification as custom or system

### Phase 5: Deploy Plan Projection

Deliverables:

- stable deploy-plan JSON schema
- projection from valid workspace to plan entries
- explicit unsupported-action diagnostics
- no production mutation

### Phase 6: IDE Product Wrapper

Deliverables:

- `OnboardedConfigIde` product wrapper
- example picker for the sample workspace
- diagnostics and relation graph panel tuned for account config
- agent instructions focused on account-workspace edits

## First Patch

The smallest useful implementation patch should create the schema package and
prove validation against fixtures:

1. Add `packages/onboarded-config` or `packages/examples/src/onboarded-config`.
2. Inline `Rule` and supported attribute constants.
3. Define the account workspace routes.
4. Add the sample `demo-account-test` workspace.
5. Add validators for:
   - duplicate custom/system paths
   - unresolved policy form refs
   - unresolved rule fact paths
   - duplicate form field paths
6. Add tests that intentionally include one broken workspace and assert the
   diagnostics.

That patch gives agents and humans a concrete YAML contract before deploy,
PDF-specific behavior, nested account distribution, or hosted collaboration
enter the scope.
