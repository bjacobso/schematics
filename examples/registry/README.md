# @schematics/examples

Neutral fixtures for the Schematics playground and package tests.
Use this package when you need ready-made artifact projects plus JSON/YAML files.
Examples currently cover survey questions, release workflows, and the
first-party Onboarded configuration artifact project from
`@schematics/onboarded-config`.
The exported package has no React, agent, or server dependency. Playground-only
custom preview renderers are colocated with each example package.
This package is the extraction target for `@schematics/examples`.

Local examples are self-contained under `projects/<example>/`:

- `example.json` describes the example, artifact project, and compatibility schema
- `schematics.config.ts` lets the CLI validate the artifact project from disk
- `files/` contains the JSON/YAML files loaded by the UI

The Onboarded example is sourced from
`examples/onboarded/projects/onboarded-account-yaml` so its schema,
fixtures, and embedded CLI can be built as a real consumer package.

Run `pnpm run generate` to bundle those definitions and files into
`src/generated/examples.ts` so browser UIs can import the examples as plain
JavaScript.

```ts
import {
  randomSchematicsExample,
  schematicsExampleDefinitions,
  schematicsExamples,
} from "@schematics/examples";

const first = schematicsExamples[0];
const project = first.project;
const random = randomSchematicsExample();
const configPath = schematicsExampleDefinitions[0]?.configPath;
```

## Generate

```bash
pnpm --dir examples/registry generate
```

The package runs generation before `build`, `test`, and `typecheck`.

## CLI Fixtures

Each example has a matching CLI config, so the same artifact projects can be validated
from disk:

```bash
schematics validate \
  --schema examples/workflow/schematics.config.ts \
  --dir examples/workflow/files \
  --json
```

Some examples intentionally contain validation errors so the UI and CLI have
diagnostics to display.

The Onboarded artifact project has its own package-local CLI and bundle script:

```bash
pnpm turbo run build:bundle --filter @schematics/onboarded-config
node examples/onboarded/dist/bundle/onboarded-config.cjs validate \
  --dir examples/onboarded/projects/onboarded-account-yaml/files \
  --json
```

## Single Executable Example CLIs

Build an example artifact project into a domain-specific CLI wrapper:

```bash
pnpm turbo run build:sea --filter @schematics/examples -- --example workflow-json --name workflow
```

The script generates a small CLI entry that embeds the selected example
project config, bundles it into one CommonJS file with `esbuild`, writes a
Node SEA config, and then calls `node --build-sea` to create the binary.
On macOS, the generated binary is ad-hoc signed automatically; pass `--no-sign`
to skip that step.

Use `--bundle-only` on Node versions that do not support `--build-sea` yet:

```bash
pnpm turbo run build:sea --filter @schematics/examples -- --example workflow-json --bundle-only
node examples/registry/dist/sea/workflow-json/bundle/entry.cjs validate \
  --dir examples/workflow/files
```

Available local examples:

```bash
pnpm turbo run build:sea --filter @schematics/examples -- --list
```

The generated binary uses the same commands as `schematics`, but the artifact
project is already embedded:

```bash
./examples/registry/dist/sea/workflow validate \
  --dir examples/workflow/files \
  --json
```
