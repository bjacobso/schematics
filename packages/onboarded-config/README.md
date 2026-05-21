# @schema-ide/onboarded-config

First-party Onboarded account configuration workspace for Schema IDE.

This package owns the Onboarded domain schemas, a YAML sample workspace, and an
embedded `onboarded-config` CLI. It is intentionally packaged like a consumer of
Schema IDE: the package imports `@schema-ide/cli`, embeds its workspace schema,
and can bundle the result with the web UI.

## Validate

```bash
pnpm turbo run build --filter @schema-ide/onboarded-config
node packages/onboarded-config/dist/cli.js validate \
  --dir packages/onboarded-config/workspaces/onboarded-account-yaml/files \
  --json
```

The same workspace can be loaded by the generic Schema IDE CLI:

```bash
schema-ide validate \
  --schema packages/onboarded-config/workspaces/onboarded-account-yaml/schema-ide.config.ts \
  --dir packages/onboarded-config/workspaces/onboarded-account-yaml/files \
  --json
```

## Web UI

Build the shared playground UI, then start the Onboarded CLI in local filesystem mode:

```bash
pnpm playground:build
pnpm turbo run build --filter @schema-ide/onboarded-config
node packages/onboarded-config/dist/cli.js web \
  --dir packages/onboarded-config/workspaces/onboarded-account-yaml/files
```

`web` is an alias for `serve`. The CLI auto-serves `apps/playground/dist` when it
exists; pass `--static-dir <path>` to use another built UI bundle.

## Bundle

`build:bundle` is wired through Turbo to build the package and the playground UI
first. The resulting CommonJS entry embeds the Onboarded workspace schema and the
web UI assets, so it can serve `/` without `apps/playground/dist` on disk.

```bash
pnpm turbo run build:bundle --filter @schema-ide/onboarded-config
node packages/onboarded-config/dist/bundle/onboarded-config.cjs validate \
  --dir packages/onboarded-config/workspaces/onboarded-account-yaml/files \
  --json
```

Run the bundled web UI with:

```bash
node packages/onboarded-config/dist/bundle/onboarded-config.cjs web \
  --dir packages/onboarded-config/workspaces/onboarded-account-yaml/files
```

Build a Node SEA binary with Node 25.5.0 or newer:

```bash
pnpm turbo run build:sea --filter @schema-ide/onboarded-config -- \
  --out packages/onboarded-config/dist/sea/onboarded-config
```
