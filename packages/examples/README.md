# @schema-ide/examples

Neutral fixtures for the Schema IDE playground and package tests.
Use this package when you need ready-made artifact projects plus JSON/YAML files.
Examples currently cover prompt evals, survey questions, release workflows, and
the first-party Onboarded configuration artifact project from
`@schema-ide/onboarded-config`.
Workflow, survey, and Onboarded are the reference artifact-first examples.
Prompt evals remain as fixtures, but their compatibility workspace schema still
uses a whole-project transform to merge JSON and YAML route groups, so they are
not used to drive artifact/workspace migration criteria.
The exported package has no React, agent, or server dependency. Playground-only
custom preview renderers are colocated with each example package.
This package is the extraction target for `@schema-ide/examples`.

Local examples are self-contained under `workspaces/<example>/`:

- `example.json` describes the example, artifact project, and compatibility schema
- `schema-ide.config.ts` lets the CLI validate the artifact project from disk
- `files/` contains the JSON/YAML files loaded by the UI

The Onboarded example is sourced from
`packages/onboarded-config/workspaces/onboarded-account-yaml` so its schema,
fixtures, and embedded CLI can be built as a real consumer package.

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
const project = first.project;
const random = randomSchemaIdeExample();
const configPath = schemaIdeExampleDefinitions[0]?.configPath;
```

## Generate

```bash
pnpm --dir packages/examples generate
```

The package runs generation before `build`, `test`, and `typecheck`.

## CLI Fixtures

Each example has a matching CLI config, so the same artifact projects can be validated
from disk:

```bash
schema-ide validate \
  --schema packages/examples/workspaces/workflow-json/schema-ide.config.ts \
  --dir packages/examples/workspaces/workflow-json/files \
  --json
```

Some examples intentionally contain validation errors so the UI and CLI have
diagnostics to display.

The Onboarded artifact project has its own package-local CLI and bundle script:

```bash
pnpm turbo run build:bundle --filter @schema-ide/onboarded-config
node packages/onboarded-config/dist/bundle/onboarded-config.cjs validate \
  --dir packages/onboarded-config/workspaces/onboarded-account-yaml/files \
  --json
```

## Single Executable Example CLIs

Build an example artifact project into a domain-specific CLI wrapper:

```bash
pnpm turbo run build:sea --filter @schema-ide/examples -- --example workflow-json --name workflow
```

The script generates a small CLI entry that embeds the selected example
project config, bundles it into one CommonJS file with `esbuild`, writes a
Node SEA config, and then calls `node --build-sea` to create the binary.
On macOS, the generated binary is ad-hoc signed automatically; pass `--no-sign`
to skip that step.

Use `--bundle-only` on Node versions that do not support `--build-sea` yet:

```bash
pnpm turbo run build:sea --filter @schema-ide/examples -- --example workflow-json --bundle-only
node packages/examples/dist/sea/workflow-json/bundle/entry.cjs validate \
  --dir packages/examples/workspaces/workflow-json/files
```

Available local examples:

```bash
pnpm turbo run build:sea --filter @schema-ide/examples -- --list
```

The generated binary uses the same commands as `schema-ide`, but the artifact
project is already embedded:

```bash
./packages/examples/dist/sea/workflow validate \
  --dir packages/examples/workspaces/workflow-json/files \
  --json
```
