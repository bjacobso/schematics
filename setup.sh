#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

if [[ -n "${SUPERSET_ROOT_PATH:-}" && "$SUPERSET_ROOT_PATH" != "$ROOT_DIR" ]]; then
  SOURCE_ENV="$SUPERSET_ROOT_PATH/.env"
  TARGET_ENV="$ROOT_DIR/.env"

  if [[ -f "$SOURCE_ENV" ]]; then
    if [[ -e "$TARGET_ENV" && ! -L "$TARGET_ENV" ]]; then
      echo ".env already exists and is not a symlink; leaving it unchanged."
    else
      ln -sfn "$SOURCE_ENV" "$TARGET_ENV"
      echo "Linked .env to $SOURCE_ENV"
    fi
  else
    echo "No .env found at $SOURCE_ENV; skipping Superset env symlink."
  fi
fi

git submodule update --init --recursive

if ! command -v pnpm >/dev/null 2>&1; then
  if command -v corepack >/dev/null 2>&1; then
    corepack enable
    corepack prepare pnpm@11.1.3 --activate
  else
    echo "pnpm is required but was not found, and corepack is unavailable." >&2
    exit 1
  fi
fi

pnpm install
