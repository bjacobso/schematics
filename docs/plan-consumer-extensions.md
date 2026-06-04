# Plan: Consumer-Packaged Domain IDEs

Schematics should be usable as a foundation for domain-specific IDE packages. A consumer should be able to bring their own workspace schema, examples, previews, tools, and documentation, then ship a package that exposes a tailored IDE without forking `@schematics/ide`.

## Goal

Enable packages like:

```ts
import { WorkflowIde } from "@acme/workflow-ide";

export function App() {
  return <WorkflowIde initialFiles={files} onFilesChange={setFiles} />;
}
```

where `@acme/workflow-ide` wraps Schematics with:

- domain schemas
- workspace routing
- preview components
- domain-specific chat/tool instructions
- examples/templates
- optional branding and UI chrome

## Non-goals

- Turn Schematics into a plugin marketplace.
- Require consumers to publish packages through a Schematics registry.
- Make consumers fork internal React components.
- Add host-application-specific Open Ontology concepts to Schematics.

## Target Consumer Shape

A consumer should be able to author:

```ts
import { defineSchematicsProduct } from "@schematics/ide";
import { WorkflowWorkspaceSchema } from "./schemas";
import { WorkflowPreview } from "./previews/workflow-preview";
import { workflowExamples } from "./examples";

export const WorkflowIdeProduct = defineSchematicsProduct({
  id: "workflow",
  title: "Workflow IDE",
  schema: WorkflowWorkspaceSchema,
  previews: [
    {
      id: "workflow-preview",
      schemaId: "Workflows",
      label: "Workflow",
      component: WorkflowPreview,
    },
  ],
  examples: workflowExamples,
  assistant: {
    systemPrompt: "You help users edit workflow definitions.",
  },
});

export const WorkflowIde = WorkflowIdeProduct.Component;
```

Consumers can still use `<Schematics />` directly, but product definitions give them a clean packaging story.

## Proposed API

```ts
export interface SchematicsProduct<A = unknown> {
  readonly id: string;
  readonly title: ReactNode;
  readonly schema: SchematicsInputSchema<A>;
  readonly defaultFormat?: SchematicsDocumentFormat;
  readonly allowedFormats?: readonly SchematicsDocumentFormat[];
  readonly previews?: readonly SchematicsPreviewRegistration[];
  readonly examples?: readonly SchematicsExample[];
  readonly assistant?: SchematicsAssistantProfile;
  readonly ui?: SchematicsUiProfile;
}

export function defineSchematicsProduct<A>(
  product: SchematicsProduct<A>,
): DefinedSchematicsProduct<A>;
```

The returned product exposes:

```ts
interface DefinedSchematicsProduct<A> {
  readonly id: string;
  readonly schema: SchematicsInputSchema<A>;
  readonly Component: ComponentType<SchematicsProductComponentProps<A>>;
  readonly createProps: (props?: Partial<SchematicsProps<A>>) => SchematicsProps<A>;
}
```

This keeps the wrapper package tiny while preserving normal React composition.

## Consumer Package Layout

Recommended layout:

```
workflow-ide/
├── src/
│   ├── index.ts
│   ├── product.tsx
│   ├── schemas.ts
│   ├── previews/
│   │   └── workflow-preview.tsx
│   ├── examples.ts
│   └── tools.ts
├── package.json
└── README.md
```

The package can expose:

```ts
export { WorkflowIde, WorkflowIdeProduct } from "./product";
export { WorkflowWorkspaceSchema, WorkflowSchema } from "./schemas";
```

## Extension Points

### Schemas

Consumers provide an Effect Schema or Workspace Schema:

```ts
schema: WorkflowWorkspaceSchema;
```

Workspace schemas remain the main way to route files to schema ids:

```ts
Workspace.files("workflows/*.yaml", WorkflowSchema).pipe(
  Workspace.annotations({ identifier: "Workflows" }),
);
```

### Previews

Consumers register previews by `schemaId`:

```ts
previews: [
  {
    id: "workflow-graph",
    schemaId: "Workflows",
    label: "Graph",
    component: WorkflowGraphPreview,
  },
];
```

Preview components receive parsed value, file metadata, reflection, diagnostics, and read-only state.

### Examples and Templates

Add a small shared example type:

```ts
export interface SchematicsExample {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly files: readonly SourceFile[];
}
```

Schematics can render an optional example picker when products provide examples. Consumers may also use examples outside the IDE.

### Assistant Profile

Consumers should be able to provide domain-specific assistant behavior without replacing the chat implementation:

```ts
interface SchematicsAssistantProfile {
  readonly systemPrompt?: string;
  readonly suggestedPrompts?: readonly string[];
  readonly tools?: readonly SchematicsToolDefinition[];
}
```

Initial version can support `systemPrompt` and `suggestedPrompts`; custom tools can follow after the agent-tool API stabilizes.

### UI Profile

Keep UI customization modest:

```ts
interface SchematicsUiProfile {
  readonly emptyState?: ReactNode;
  readonly headerActions?: ReactNode;
  readonly hideDebugByDefault?: boolean;
}
```

Avoid broad theming in the first pass. Consumers can wrap the component with their own theme provider or container.

## Package Boundary

`@schematics/ide` should expose stable composition APIs:

- `<Schematics />`
- `defineSchematicsProduct(...)`
- preview registration types
- example types
- assistant profile types

`@schematics/core` should remain React-free:

- workspace schema
- validation
- parsing
- reflection
- source maps

Consumer packages should not import internal files like:

```ts
@schematics/ide/src/Schematics
```

Everything needed for product wrapping should come from public exports.

## Data Flow

```
consumer package
   │
   ├── schemas ───────────────┐
   ├── previews ──────────────┤
   ├── examples ──────────────┤
   └── assistant profile ─────┤
                              ▼
                    defineSchematicsProduct
                              │
                              ▼
                      Product Component
                              │
                              ▼
                          <Schematics />
```

## Implementation Phases

### Phase 1: Public Product Definition

- Add `defineSchematicsProduct` to `@schematics/ide`.
- Add product, example, assistant profile, and UI profile types.
- Return a simple component that passes configured props through to `<Schematics />`.
- Add isolated tests for prop merging and product component export.

### Phase 2: Examples

- Add optional example metadata and public `SchematicsExample` type.
- Support example picker either inside `<Schematics />` or as a helper component.
- Keep `@schematics/examples` compatible with the same type.

### Phase 3: Assistant Customization

- Add assistant profile support to the local chat adapter path.
- Include product title/schema ids/examples in assistant context.
- Add suggested prompt UI if provided.

### Phase 4: Consumer Package Template

- Add a documented package template under a future Schematics templates path.
- Include package manifest, schemas, preview, examples, and README.
- Add a smoke test that imports the generated wrapper package shape.

### Phase 5: Optional CLI Scaffold

- Add `schematics create-product` only if the template proves useful.
- Keep scaffold output simple and editable.

## Example Product Package

Create a first-party fixture package for validation:

```
examples/product-fixtures/workflow-ide
```

This package should depend only on public `@schematics/*` exports. It should prove that a consumer can package a domain-specific IDE without reaching into internals.

## Testing Strategy

- Unit-test `defineSchematicsProduct` prop merging.
- Type-test a consumer wrapper that exports `WorkflowIde`.
- Verify preview registrations still work through the product wrapper.
- Verify examples can be selected and loaded.
- Verify package build output exposes stable public types.

## Verification Commands

```bash
pnpm format
pnpm typecheck --filter @schematics/ide
pnpm test --filter @schematics/ide
pnpm build --filter @schematics/ide
pnpm typecheck --filter '@schematics/*'
pnpm test --filter '@schematics/*'
pnpm build --filter '@schematics/*'
```

## Open Questions

- Should `defineSchematicsProduct` live in `@schematics/ide` or a new `@schematics/product` package?
- Should examples be part of the core API or only a React/product concern?
- How much assistant customization should be declarative before consumers need a custom chat adapter?
- Should preview components be able to declare their own toolbar actions?
- Should a product wrapper support multiple workspace schemas, or should that be modeled as separate products?
