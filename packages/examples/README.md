# @schema-ide/examples

Neutral fixtures for the Schema IDE playground and package tests.
Use this package when you need a ready-made workspace schema plus JSON/YAML files.
Examples currently cover prompt evals, survey questions, and release workflows.
The package depends on core only and has no React, agent, or server dependency.
This package is the extraction target for `@schema-ide/examples`.

Each example is self-contained under `workspaces/<example>/`:

- `example.json` describes the example and the workspace schema it uses
- `schema-ide.config.ts` lets the CLI validate the workspace from disk
- `files/` contains the JSON/YAML files loaded by the UI

Run `pnpm run generate` to bundle those definitions and files into
`src/generated/examples.ts` so browser UIs can import the examples as plain
JavaScript.

```ts
import {
  randomSchemaIdeExample,
  schemaIdeExampleDefinitions,
  schemaIdeExamples,
} from "@schema-ide/examples";

const first = schemaIdeExamples[0];
const random = randomSchemaIdeExample();
const configPath = schemaIdeExampleDefinitions[0]?.configPath;
```

## Generate

```bash
pnpm --dir packages/examples generate
```

The package runs generation before `build`, `test`, and `typecheck`.

## CLI Fixtures

Each example has a matching CLI config under `workspaces/<example>/`, so the
same workspaces can be validated from disk:

```bash
schema-ide validate \
  --schema packages/examples/workspaces/workflow-json/schema-ide.config.ts \
  --dir packages/examples/workspaces/workflow-json/files \
  --json
```

Some examples intentionally contain validation errors so the UI and CLI have
diagnostics to display.

## Single Executable Example CLIs

Build an example workspace schema into a domain-specific CLI wrapper:

```bash
pnpm --dir packages/examples build:sea -- --example workflow-json --name workflow
```

The script generates a small CLI entry that embeds the selected example
workspace config, bundles it into one CommonJS file with `esbuild`, writes a
Node SEA config, and then calls `node --build-sea` to create the binary.

Use `--bundle-only` on Node versions that do not support `--build-sea` yet:

```bash
pnpm --dir packages/examples build:sea -- --example workflow-json --bundle-only
node packages/examples/dist/sea/workflow-json/bundle/entry.cjs validate \
  --dir packages/examples/workspaces/workflow-json/files
```

Available examples:

```bash
pnpm --dir packages/examples build:sea -- --list
```

The generated binary uses the same commands as `schema-ide`, but the schema is
already embedded:

```bash
./packages/examples/dist/sea/workflow validate \
  --dir packages/examples/workspaces/workflow-json/files \
  --json
```
