# Plan: Source-Mapped JSON/YAML Parsing

Schematics currently validates decoded JavaScript values. That is enough for schema correctness, but not enough for precise editor diagnostics because Effect Schema does not know where a decoded value came from in the source file. The current cross-file diagnostic location support is heuristic: it scans file text for likely ids, properties, and values. This plan replaces that with a first-class source map from parsed document paths to file ranges.

## Goals

- Produce stable source locations for JSON and YAML values during parsing.
- Map Effect Schema issue paths and workspace `issue.at(...)` paths back to concrete `{ path, line, column }` locations.
- Support nested object and array paths, including paths like `requiredFieldIds.1`, `steps.3.actionId`, and `metadata.labels.owner`.
- Keep existing decoded value APIs intact so callers can continue using plain values.
- Make CodeMirror diagnostics and file-tree badges rely on source-mapped diagnostics instead of text-search heuristics.

## Non-goals

- Replace Effect Schema validation.
- Add a new authoring format beyond JSON/YAML.
- Make comments or formatting round-trip through the decoder.
- Build a full YAML language server. The parser source map only needs enough fidelity for diagnostics and navigation.

## Current Behavior

```
source text
    │
    ▼
JSON.parse / YAML.parseDocument(...).toJSON()
    │
    ▼
plain JS value ──▶ Effect Schema validation
    │                     │
    │                     ▼
    │              logical issue path
    │              e.g. datasetId
    ▼
workspace validator
issue.at("evals.support-routing.datasetId", ...)
    │
    ▼
heuristic text scan
```

This works for common flat documents but is not reliable for nested paths, repeated property names, duplicate scalar values, or arrays.

## Target Design

Parsing should return both the decoded value and a source map:

```ts
export interface SourceRange {
  readonly path: string;
  readonly start: SourcePosition;
  readonly end: SourcePosition;
}

export interface SourcePosition {
  readonly line: number;
  readonly column: number;
  readonly offset: number;
}

export interface DocumentSourceMap {
  readonly filePath: string;
  readonly format: SchematicsDocumentFormat;
  readonly locate: (documentPath: readonly PropertyKey[]) => SourceRange | null;
  readonly locateStringPath: (documentPath: string) => SourceRange | null;
}

export interface ParsedDocument {
  readonly value: unknown;
  readonly sourceMap: DocumentSourceMap;
}
```

The parse result becomes:

```ts
export type SchematicsParseResult =
  | { readonly success: true; readonly document: ParsedDocument }
  | { readonly success: false; readonly diagnostic: SchematicsDiagnostic };
```

Compatibility helpers can continue exposing `parseDocument(...).value` or the parse result can keep a `value` alias during the transition.

## Path Model

Use normalized document paths internally:

```ts
["datasetId"][("requiredFieldIds", 1)][("steps", 3, "actionId")];
```

String diagnostics still use dot paths for existing APIs:

```ts
"datasetId";
"requiredFieldIds.1";
"steps.3.actionId";
```

The source map parser should normalize numeric path segments to numbers when they index arrays.

## JSON Parser Strategy

`JSON.parse` does not preserve source locations. Use a parser that exposes a CST or tokens.

Candidate approaches:

- Use a small JSON parser that exposes node offsets.
- Use CodeMirror JSON parser only inside the React editor and keep core independent. This is less attractive because diagnostics are produced in `@schematics/core`.
- Implement a narrow recursive JSON parser in core that returns `{ value, nodeRanges }`.

Preferred first pass: use a proven JSON parser library if it is small and has source positions. If dependency cost is not acceptable, implement the narrow parser because Schematics only needs standard JSON, not JSONC.

JSON source map rules:

- Object property path maps to the value node range.
- If a validation error is about a missing required property, map to the containing object range.
- Array index path maps to the element node range.
- Root path maps to the full document range.

## YAML Parser Strategy

The `yaml` package already parses into a document/node tree with source ranges. Keep using it, but walk the YAML AST before converting to JSON.

YAML source map rules:

- Mapping key path maps to the value node range when available.
- Missing property diagnostics map to the containing map range.
- Sequence index path maps to the item node range.
- Scalar paths map to the scalar node range.
- If an AST node lacks range data, fall back to the nearest parent range.

## Workspace Integration

Workspace validation should retain parse artifacts per file:

```
SourceFile[]
    │
    ▼
ParsedWorkspace
    ├── decoded field values
    ├── route matches
    └── sourceMaps: Map<filePath, DocumentSourceMap>
```

`FileSetSchema.decode` should return matched files with source maps:

```ts
interface MatchedFile<A> {
  readonly path: string;
  readonly value: A;
  readonly sourceMap: DocumentSourceMap;
}
```

Public value transforms like `Workspace.indexBy("id")` can keep returning maps of values, but validators need access to source-aware issue resolution.

## Cross-File Diagnostic API

Keep the existing API:

```ts
issue.at("evals.support-routing.datasetId", "Unknown dataset: missing-support-tickets");
```

Add a resolver that understands workspace field collections and matched file ids:

```
evals.support-routing.datasetId
  │       │              │
  │       │              └── document path inside the file
  │       └──────────────── entity id
  └──────────────────────── workspace field / collection
```

Resolution algorithm:

1. Find workspace field `evals`.
2. Find matched file whose decoded value has `id === "support-routing"`.
3. Locate document path `["datasetId"]` in that file source map.
4. Attach `path`, `line`, and `column` to the diagnostic.

For non-id collections, support explicit file paths:

```ts
issue.at("evals/support-routing.yaml:datasetId", "Unknown dataset");
```

This explicit form can be added later if the field/id convention is not enough.

## Effect Schema Diagnostics

Effect Schema parse errors already include logical issue paths. Convert those paths directly through the active file source map:

```ts
parseErrorIssue.path; // ["requiredFieldIds", 1]
sourceMap.locate(path); // policies/check.json:8:5
```

If the exact path is not found, walk to the nearest parent path:

```ts
["steps", 3, "actionId"] -> ["steps", 3] -> ["steps"] -> []
```

## React Integration

`@schematics/ide` should not do source-location inference. It should consume diagnostics with concrete locations from core.

Required updates:

- Keep CodeMirror lint filtering by `diagnostic.path === activeFile`.
- Keep file-tree badges based on diagnostics with concrete `path`.
- Add click-to-open from the diagnostics debug panel once diagnostics have reliable line numbers.
- Remove the current text-search heuristic after source maps cover JSON and YAML.

## Implementation Phases

### Phase 1: Source Map Types

- Add `SourcePosition`, `SourceRange`, `DocumentSourceMap`, and `ParsedDocument` to `@schematics/core`.
- Add tests for path normalization and source map lookup.
- Keep existing parse callers working.

### Phase 2: YAML Source Map

- Walk `yaml` document nodes and build path-to-range entries.
- Cover mappings, sequences, scalars, nested objects, and arrays.
- Add tests for `.yaml` and `.yml` diagnostics.

### Phase 3: JSON Source Map

- Choose parser approach.
- Build source map for objects, arrays, strings, numbers, booleans, and null.
- Add tests equivalent to YAML tests.

### Phase 4: Schema Validation Locations

- Thread source maps through `validateSingleDocument` and `FileSetSchema.decode`.
- Attach source locations to Effect Schema diagnostics via issue paths.
- Add tests for nested schema failures in JSON and YAML.

### Phase 5: Cross-File Locations

- Replace the heuristic resolver in `workspace-schema.ts`.
- Resolve `field.id.property.path` through matched file metadata and source maps.
- Add tests for examples like `evals.support-routing.datasetId`.

### Phase 6: UI Polish

- Add diagnostics-panel rows that show `file:line:column`.
- Make diagnostics rows clickable to open the file and reveal the line.
- Verify file badges and CodeMirror markers only appear on affected files.

## Test Matrix

| Case                          | JSON | YAML |
| ----------------------------- | ---- | ---- |
| Parse error location          | yes  | yes  |
| Root schema type error        | yes  | yes  |
| Object property type error    | yes  | yes  |
| Missing required property     | yes  | yes  |
| Array element error           | yes  | yes  |
| Nested object in array error  | yes  | yes  |
| Cross-file unknown reference  | yes  | yes  |
| File tree badge affected file | yes  | yes  |

## Verification Commands

```bash
pnpm format
pnpm typecheck --filter @schematics/core --filter @schematics/ide
pnpm test --filter @schematics/core --filter @schematics/ide
pnpm build --filter @schematics/core --filter @schematics/ide
```

## Open Questions

- Should `MatchedFile<A>` expose `sourceMap` publicly, or should source maps remain internal to validation?
- Should workspace `issue.at(...)` continue using `field.id.path`, or should it grow an explicit structured API?
- Should missing-property diagnostics point at the parent object or the closest following key location?
- Should YAML anchors/aliases preserve locations at the alias site or resolved value site?
