# Working on Schematics

Schematics is a pre-1.0, Effect-native config-as-code control plane. Its packages
are private and the resource/document vocabulary is still migrating. The public
site also introduces the independent Schema Reflection libraries it consumes.

## Setup and checks

Use Node 25.9.0 and pnpm 11.1.3, pinned in `mise.toml`, `package.json`, and
`pnpm-workspace.yaml`. With those tools available:

```bash
pnpm install --frozen-lockfile
pnpm check
```

`pnpm check` runs formatting, `llms.txt` validation, package tests, TypeScript
checks, builds, the playground build, and the local HTTP smoke check. It needs
no Cloudflare credentials or model key. `pnpm format` applies formatting.

Use `pnpm dev` for the playground and API, or `pnpm serve` to build and serve
them from one Node process. Without an OpenRouter key, chat uses a deterministic
local debug responder.

Run targeted tasks through Turbo so dependencies are built first:

```bash
pnpm turbo run test --filter @schematics/cli
pnpm turbo run typecheck --filter @schematics/ide
```

Direct `pnpm --filter <package> test` can fail in a fresh checkout because some
tests load package `dist` exports. Browser end-to-end tests are a separate,
optional `pnpm playground:e2e` command and require Playwright browsers.

## Layout

- `packages/`: artifact contracts, core runtime, provider DSL, reconciliation
  (`alchemy`), deploy services, protocol, agent tools, IDE, CLI, and servers.
- `examples/`: provider packages and fixtures; start with `toy`, then `catalog`
  for richer relation modeling.
- `apps/playground/`: Astro static homepage with Foldkit/Foldworks demos and a React editor playground;
  `public/llms.txt` is the checked-in agent entry point, copied by Astro.
- `apps/ide/`: standalone IDE app.
- `docs/`: Markdown architecture and usage guides plus explicitly named plans;
  there is no documentation-site build.
- `alchemy/` and `alchemy.run.ts`: Cloudflare deployment resources.
- `scripts/`: local and hosted smoke checks, docs validation, preview cleanup.
- `.github/workflows/`: CI, production deployment, previews, and cleanup.

## Conventions and boundaries

Use TypeScript, Effect, pnpm workspaces and catalog versions, and the existing
oxfmt formatter. Keep package dependencies one-way. Keep wire contracts in
`protocol`, model/tool execution in `agent`, editor composition in `ide`, and
HTTP adapters in the server packages. Import other projects through packages,
not sibling source trees; Schema Reflection is an independent npm dependency.

Prefer `defineResource(...)` and `defineProvider(...)` for new provider-backed
projects. The `ArtifactProject` contract remains the document routing API;
`Workspace.Struct` is deprecated compatibility sugar. Keep planned behavior
distinct from shipped behavior in docs, including `llms.txt`.

Update `apps/playground/public/llms.txt` when its authoritative guides change.
`pnpm llms:check` checks structure and repository/static link targets offline;
`pnpm llms:check --dist` also checks the Astro output. The HTTP smoke verifies
that `/llms.txt` serves that exact file with a text content type.

Do not add host-specific imports, fixtures, or private repository links. Do not
publish the private packages or deploy manually as part of a code change;
production deploys through the existing pipeline after merge. Keep credentials
out of source and logs. `PLAN.md` is gitignored local planning space.
