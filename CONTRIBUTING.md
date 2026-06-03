# Contributing

Schematics is organized as small packages with one-way dependencies. Keep reusable behavior in `core`, wire contracts in `protocol`, model/tool execution in `agent`, UI composition in `react`, HTTP in `server`, shared primitives in `ui`, and neutral fixtures in `examples`.

Before opening a pull request, run:

```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm test
pnpm typecheck
pnpm build
pnpm playground:build
```

Changes should not add host-application imports or host-specific fixtures to this tree. Add new demos to `examples` only when they are generic enough for other Effect projects to reuse.
