# @schema-ide/schema-algebra

Schema Algebra is the schema-native programming toolkit for Schema IDE.

Effect Schema already validates values. Schema Algebra uses those same schema
nodes as the place to declare reusable IDE semantics: relation metadata today,
and paths, traversal, constraints, lenses, projections, diffs, patches,
generation, fingerprints, migrations, previews, and agent-safe edits over time.

This package is intentionally UI-free. It does not depend on React, CodeMirror,
the Schema IDE server, or browser-only APIs. It should stay usable in Node,
browsers, tests, CLIs, and agents.

## Status

Implemented:

- `Relation.id`, `Relation.ref`, and `Relation.refs` schema combinators
- `Relation.derivedId` for definitions derived from object values
- `Relation.pathRef` and `Relation.pathRefs` for path-like references
- typed relation edges on references
- relation annotation storage on Effect Schema AST nodes
- relation graph extraction from a schema and decoded value
- duplicate ID validation
- unresolved reference validation
- scoped references through parent definitions or sibling fields
- relative scoped references such as `../form` from nested values
- relation diagnostics with structured paths and relation metadata

Planned:

- canonical `Path` helpers
- reusable `Traversal` over Effect Schema ASTs and values
- shared `Annotation` utilities
- field-scoped `Constraint` diagnostics
- immutable `Lens` and `Patch` primitives
- schema-aware `Projection`, `Diff`, `Generate`, and `Fingerprint` modules
- workspace integration through `@schema-ide/core`
- IDE and agent features derived from the same algebra graph

The package was renamed from the earlier `schema-relations` experiment. The
current code is Phase 1 of the broader algebra plan.

## Install

Inside this monorepo:

```bash
pnpm --filter @schema-ide/schema-algebra test
pnpm --filter @schema-ide/schema-algebra typecheck
pnpm --filter @schema-ide/schema-algebra build
```

Current dependency boundary:

- runtime: `effect`
- development: `typescript`, `vitest`, `tsdown`

## Quick Start

Declare IDs and references directly on schema fields:

```ts
import { Schema } from "effect";
import { Relation } from "@schema-ide/schema-algebra";

const ActionSchema = Schema.Struct({
  id: Relation.id("Action"),
  kind: Schema.Literal("email", "task", "webhook"),
  label: Schema.String,
});

const WorkflowSchema = Schema.Struct({
  id: Relation.id("Workflow", { display: "name" }),
  name: Schema.String,
  actionIds: Relation.refs("Action"),
});

const WorkspaceSchema = Schema.Struct({
  actions: Schema.Array(ActionSchema),
  workflows: Schema.Array(WorkflowSchema),
});
```

Build a graph:

```ts
const graph = Relation.graph(WorkspaceSchema, {
  actions: [{ id: "send-email", kind: "email", label: "Send email" }],
  workflows: [{ id: "onboarding", name: "Onboarding", actionIds: ["send-email"] }],
});

graph.definitions;
// [
//   { type: "Action", id: "send-email", path: ["actions", "0", "id"] },
//   { type: "Workflow", id: "onboarding", path: ["workflows", "0", "id"], display: "Onboarding" },
// ]

graph.references;
// [
//   { target: "Action", id: "send-email", path: ["workflows", "0", "actionIds", "0"] },
// ]
```

Validate the same graph:

```ts
const diagnostics = Relation.validate(WorkspaceSchema, {
  actions: [],
  workflows: [{ id: "onboarding", name: "Onboarding", actionIds: ["missing"] }],
});

diagnostics;
// [
//   {
//     severity: "error",
//     code: "unresolved-ref",
//     path: ["workflows", "0", "actionIds", "0"],
//     message: 'Unresolved Action reference "missing"',
//     relation: { target: "Action", id: "missing", ... }
//   }
// ]
```

The top-level names are also exported for compatibility:

```ts
import { buildRelationGraph, validateRelations } from "@schema-ide/schema-algebra";
```

## API

### `Relation.id(type, options?)`

Declares that a string field defines an entity ID.

```ts
const UserSchema = Schema.Struct({
  id: Relation.id("User"),
});
```

Options:

- `display`: a path inside the containing object used as a human-readable label.
- `scope`: a relation scope. Use `Relation.parent(type)` for nested IDs, or
  `Relation.path(path)` for a value elsewhere in the root value.

Example with display text:

```ts
const WorkflowSchema = Schema.Struct({
  id: Relation.id("Workflow", { display: "name" }),
  name: Schema.String,
});
```

### `Relation.ref(target, options?)`

Declares that a string field references an entity ID.

```ts
const WorkflowSchema = Schema.Struct({
  actionId: Relation.ref("Action"),
});
```

Options:

- `scope`: explicit scope resolved through `Relation.parent` or
  `Relation.path`.
- `scopedBy`: path inside the nearest object whose string value determines the
  reference scope.

### `Relation.refs(target, options?)`

Declares an array of references.

```ts
const WorkflowSchema = Schema.Struct({
  actionIds: Relation.refs("Action"),
});
```

This is equivalent to:

```ts
Schema.Array(Relation.ref("Action"));
```

### `Relation.pathRef(target, options?)`

Declares that a string field references a path-like ID. Validation behavior is
the same as `Relation.ref`; the graph records `valueKind: "path"` so consumers
can distinguish path references from ordinary IDs.

```ts
const MappingEntrySchema = Schema.Struct({
  formField: Relation.pathRef("FormField", {
    scopedBy: "../form",
    edge: "maps_form_field",
  }),
});
```

`scopedBy` can point at a sibling path or use `..` segments to resolve from an
ancestor object. This stays value-relative; Schema Algebra does not know about
files or workspaces.

### `Relation.pathRefs(target, options?)`

Declares an array of path-like references.

```ts
const RuleSchema = Schema.Struct({
  facts: Relation.pathRefs("AttributePath"),
});
```

### `Relation.derivedId(schema, type, options)`

Annotates an object schema as defining an ID derived from one of its own fields.
This is useful when the identifier is not literally named `id`, such as form
field paths or generated PDF field names.

```ts
const FormFieldSchema = Relation.derivedId(
  Schema.Struct({
    path: Schema.String,
    label: Schema.String,
  }),
  "FormField",
  {
    id: "path",
    scope: Relation.parent("Form"),
    display: "label",
  },
);
```

Derived definitions are still ordinary graph definitions. They participate in
duplicate detection, unresolved-reference validation, and graph queries.

### Typed edges

References can carry an `edge` label.

```ts
const PolicySchema = Schema.Struct({
  formId: Relation.ref("Form", { edge: "requires" }),
});
```

Edges do not affect validation. They make the graph more useful for impact
analysis, explainability, and agent queries.

### `Relation.parent(type)`

Uses the nearest enclosing definition of `type` as the relation scope.

```ts
const FieldSchema = Schema.Struct({
  id: Relation.id("Field", { scope: Relation.parent("Form") }),
  label: Schema.String,
});

const FormSchema = Schema.Struct({
  id: Relation.id("Form"),
  fields: Schema.Array(FieldSchema),
});
```

In this example, field IDs are scoped to their containing form ID.

### `Relation.path(path)`

Uses a value at a root-relative path as the relation scope.

```ts
const DocumentSchema = Schema.Struct({
  workspaceId: Schema.String,
  localId: Relation.id("Document", { scope: Relation.path("workspaceId") }),
});
```

### `Relation.key(path)`

Normalizes a string path or tuple path into the internal path representation.

```ts
Relation.key("steps.0.actionId"); // ["steps", "0", "actionId"]
Relation.key(["steps", "0", "actionId"]); // ["steps", "0", "actionId"]
```

### `Relation.graph(schema, value)`

Returns a `RelationGraph`:

```ts
interface RelationGraph {
  readonly definitions: readonly RelationDefinition[];
  readonly references: readonly RelationReference[];
}
```

Definitions include:

- `type`: relation type, such as `"Action"`
- `id`: string ID value
- `path`: path to the ID field
- `scope`: optional resolved scope
- `display`: optional display string

References include:

- `target`: relation target type
- `id`: referenced ID value
- `path`: path to the reference field or array element
- `scope`: optional resolved scope
- `scopedBy`: optional path used to resolve the scope

### `Relation.validate(schema, value)`

Returns structured diagnostics:

```ts
interface RelationDiagnostic {
  readonly severity: "error" | "warning" | "info";
  readonly code: "duplicate-id" | "unresolved-ref" | "invalid-relation-value";
  readonly path: readonly string[];
  readonly message: string;
  readonly relation: RelationDefinition | RelationReference;
}
```

Current validation checks:

- duplicate IDs with the same type, ID, and scope
- references that cannot resolve to a definition
- relation annotations attached to non-string values

## Scoped Relations

Scoped relations are useful when IDs are only unique inside a parent entity.

```ts
const FieldSchema = Schema.Struct({
  id: Relation.id("Field", { scope: Relation.parent("Form") }),
  label: Schema.String,
});

const FormSchema = Schema.Struct({
  id: Relation.id("Form"),
  fields: Schema.Array(FieldSchema),
});

const PolicySchema = Schema.Struct({
  id: Relation.id("Policy"),
  formId: Relation.ref("Form"),
  requiredFieldIds: Relation.refs("Field", { scopedBy: "formId" }),
});
```

For each `requiredFieldIds` entry, the nearest object is the policy. The
`scopedBy: "formId"` option reads `policy.formId` and validates the field
reference against field definitions scoped to that form.

This supports invariants like:

```text
Policy.requiredFieldIds[*]
  references Field.id
  scoped through Policy.formId
```

## Effect Schema Traversal Notes

Relation extraction currently walks these Effect Schema AST shapes:

- type literals / structs
- tuple and array-like tuple rest nodes
- unions
- refinements
- transformations
- suspends

The traversal is intentionally private for now. Phase 2 will promote a stable
`Traversal` module so other algebra features do not need to reimplement AST
walking.

## Package Boundary

`@schema-ide/schema-algebra` owns schema-native semantics:

- Effect Schema AST traversal
- schema/value path algebra
- annotations and combinators
- relation graph extraction
- constraints and diagnostics
- projections and lenses
- schema-aware diff/patch
- migration and test generation helpers

`@schema-ide/core` owns workspace concerns:

- document parsing
- workspace routing
- validation/reflection orchestration
- source maps
- file/source locations

`@schema-ide/react` owns UI concerns:

- editor UI
- previews
- diagnostics UI
- command palette and product wrappers

The algebra package should not depend on `@schema-ide/core`. Core can wrap
algebra output with route matches, source maps, and file-level diagnostics.

## Declarative Workspace Validation

Imperative workspace validators answer one question: is this workspace valid?

```ts
Workspace.validate("workflow action references resolve", ({ workflows, actions }, issue) => {
  for (const workflow of workflows.values()) {
    for (const actionId of workflow.actionIds) {
      if (!actions.has(actionId)) {
        issue.at(`workflows.${workflow.id}.actionIds`, `Unknown action: ${actionId}`);
      }
    }
  }
});
```

Schema Algebra moves the semantic declaration next to the field:

```ts
const ActionSchema = Schema.Struct({
  id: Relation.id("Action"),
  kind: Schema.Literal("email", "task", "webhook"),
  label: Schema.String,
});

const WorkflowSchema = Schema.Struct({
  id: Relation.id("Workflow"),
  name: Schema.String,
  actionIds: Relation.refs("Action"),
});
```

The same declaration can eventually power:

- validation
- autocomplete
- go-to-definition
- find references
- safe rename
- impact analysis before deleting an entity
- structured patch proposals
- diagnostic explanations

## Proposed Modules

### `Path`

Canonical paths through schema and value trees.

```ts
Path.parse("steps.0.actionId");
Path.parent("steps.0.actionId");
Path.matches("steps.*.actionId", ["steps", 0, "actionId"]);
Path.get(value, "steps.0.actionId");
```

Responsibilities:

- normalize string and tuple paths
- identify parent and child paths
- support wildcards
- serialize paths for diagnostics and source maps

### `Traversal`

Walk schema ASTs, decoded values, or both together.

```ts
Traversal.walkSchema(WorkflowSchema, visitor);
Traversal.walkValue(WorkflowSchema, workflow, visitor);
Traversal.collect(WorkflowSchema, workflow, (node) => ...);
```

Responsibilities:

- hide Effect Schema AST details
- visit structs, arrays, tuples, unions, refinements, transformations, and suspends
- expose current schema path and value path
- support early exit and filtered collection

### `Annotation`

Structured metadata on schema nodes.

```ts
Schema.String.pipe(Annotation.help("Shown to workflow operators"));
Schema.String.pipe(Annotation.group("Identity"));
```

Responsibilities:

- define stable annotation keys
- read and write annotations consistently
- expose annotation discovery for docs, forms, previews, and agents

### `Relation`

First-class IDs, refs, scoped refs, graph extraction, and relation validation.

```ts
Relation.id("Workflow");
Relation.ref("Action");
Relation.refs("Action", { scopedBy: "workspaceId" });
Relation.graph(schema, value);
Relation.validate(schema, value);
```

Responsibilities:

- collect definitions and references
- validate unresolved refs and duplicate IDs
- power autocomplete, go-to-definition, find references, and rename
- support scoped references

### `Constraint`

Reusable constraints that can live near fields instead of only in top-level
validators.

```ts
Schema.String.pipe(Constraint.unique("Workflow id"));
Schema.Array(Schema.String).pipe(Constraint.nonEmpty("At least one action"));
```

Responsibilities:

- attach semantic constraints to schema nodes
- collect constraints during traversal
- emit structured diagnostics
- map diagnostics to source ranges through core source maps

### `Lens`

Typed read/write focus into schema-shaped values.

```ts
const actionIds = Lens.path(WorkflowSchema, "actionIds");
actionIds.get(workflow);
actionIds.update(workflow, (ids) => [...ids, "send-email"]);
```

Responsibilities:

- safe immutable edits
- compose nested paths
- support generated form controls and preview update APIs

### `Projection`

Derive smaller or transformed schemas from larger schemas.

```ts
Projection.pick(UserSchema, ["id", "email"]);
Projection.omit(UserSchema, ["internalNotes"]);
Projection.redact(UserSchema, ["ssn"]);
```

Responsibilities:

- public/admin/agent-safe/log-safe schema views
- form-specific schema projections
- preview-specific schema projections

### `Diff`

Schema-aware value diffs.

```ts
Diff.value(WorkflowSchema, before, after);
Diff.workspace(WorkspaceSchema, beforeFiles, afterFiles);
```

Responsibilities:

- compare arrays by IDs when relation metadata exists
- report semantic changes instead of only text changes
- power review UI and agent patch explanations

### `Patch`

Safe structured edits over schema-shaped values.

```ts
Patch.set("steps.0.actionId", "send-email");
Patch.insert("steps", newStep);
Patch.renameId("Action", "old", "new");
```

Responsibilities:

- typed edits
- schema validation before and after
- patch composition
- rollback and conflict detection

### `Generate`

Produce examples, empty states, edge cases, and fixtures.

```ts
Generate.example(WorkflowSchema);
Generate.emptyFormValue(WorkflowSchema);
Generate.invalidCases(WorkflowSchema);
```

Responsibilities:

- seed examples
- generate test corpora
- produce form defaults
- create relation-breaking negative tests

### `Fingerprint`

Stable schema fingerprints.

```ts
Fingerprint.schema(WorkflowSchema);
Fingerprint.compatibility(oldSchema, newSchema);
```

Responsibilities:

- cache invalidation
- migration detection
- schema compatibility checks
- versioned package/product metadata

## Integration Direction

`@schema-ide/core` should use schema algebra for:

- route-aware relation validation
- source-mapped diagnostics
- reference indexes
- schema reflection
- source-aware patches

`@schema-ide/react` should use schema algebra for:

- autocomplete
- go-to-definition
- find references
- graph previews
- diagnostics explanations
- file tree badges
- command palette actions
- preview update APIs

`@schema-ide/agent` should use schema algebra for:

- constrained edit tools
- explain/fix diagnostics
- migration proposals
- semantic refactors
- relation-aware patch proposals

## Implementation Phases

### Phase 1: Rename And Stabilize Relation Experiment

- Rename `schema-relations` to `@schema-ide/schema-algebra`.
- Keep current relation APIs under `Relation`.
- Preserve tests for IDs, refs, scoped refs, duplicate IDs, and unresolved refs.
- Add package README with algebra vision and relation examples.

### Phase 2: Path And Traversal

- Add `Path` helpers.
- Add schema traversal over common Effect Schema AST nodes.
- Add schema-plus-value traversal.
- Replace private traversal in relation graph extraction.

### Phase 3: Annotation Layer

- Create stable annotation utilities.
- Move relation annotations onto shared annotation helpers.
- Add helpers for help text, grouping, hidden/read-only, examples.

### Phase 4: Relation-Powered IDE Features

- Use `Relation` output for autocomplete and references.
- Add relation graph debug output.
- Add rename-ID patch primitive.

### Phase 5: Lens, Patch, And Preview Updates

- Add typed path/lens primitives.
- Add immutable patch operations.
- Give previews an optional typed update API backed by patches.

### Phase 6: Diff And Migration

- Add schema-aware value diff.
- Use relation IDs for array/object matching.
- Add migration planning primitives from old/new schemas.

### Phase 7: Generate And Test Corpus

- Add example/default generation.
- Add invalid-case generation.
- Use generated corpora in Schema IDE examples and eval tests.

## Verification

Run the package gates:

```bash
pnpm typecheck --filter @schema-ide/schema-algebra
pnpm test --filter @schema-ide/schema-algebra
pnpm build --filter @schema-ide/schema-algebra
```

Run integration-facing checks when changing contracts:

```bash
pnpm typecheck --filter @schema-ide/core --filter @schema-ide/react --filter @schema-ide/agent
pnpm test --filter @schema-ide/core --filter @schema-ide/react --filter @schema-ide/agent
```
