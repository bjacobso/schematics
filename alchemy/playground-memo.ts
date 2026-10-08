import type { MemoOptions } from "alchemy/Command/Memo";

// Alchemy evaluates these globs from the Vite root (apps/playground), not
// the repository root. Include public assets so edits trigger an upload.
export const playgroundMemo = {
  lockfile: true,
  include: [
    "**/*",
    "../../alchemy/**",
    "../../packages/*/src/**",
    "../../packages/*/package.json",
    "../../package.json",
    "../../pnpm-workspace.yaml",
    "../../tsconfig.base.json",
    "../../vitest.aliases.ts",
  ],
} satisfies MemoOptions;
