#!/usr/bin/env bash
set -euo pipefail

env_file="${ENV_FILE:-.env}"
repo="${GITHUB_REPOSITORY:-bjacobso/schematics}"

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  cat <<EOF
Usage: scripts/set-openrouter-github-secret.sh

Loads OPENROUTER_API_KEY from .env and writes it to the GitHub repository
secret OPENROUTER_API_KEY with gh.

Environment overrides:
  ENV_FILE=.env.local
  GITHUB_REPOSITORY=owner/repo
EOF
  exit 0
fi

if [[ ! -f "$env_file" ]]; then
  echo "Missing $env_file. Create it with OPENROUTER_API_KEY=sk-or-v1-..." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$env_file"
set +a

: "${OPENROUTER_API_KEY:?OPENROUTER_API_KEY missing from $env_file}"

if [[ "$OPENROUTER_API_KEY" == "sk-or-v1-" || "$OPENROUTER_API_KEY" == "sk-or-v1-..." ]]; then
  echo "OPENROUTER_API_KEY in $env_file still looks like a placeholder." >&2
  exit 1
fi

gh secret set OPENROUTER_API_KEY \
  --repo "$repo" \
  --body "$OPENROUTER_API_KEY"

echo "Set OPENROUTER_API_KEY for $repo"
