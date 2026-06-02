/**
 * Canonical glob matching for workspace/artifact file routes.
 *
 * This is the single source of truth shared by the artifact project router,
 * core workspace routing, the CLI file include matcher, and the React file
 * tree. Previously each of those reimplemented their own matcher with
 * divergent `**` and top-level semantics; consolidating them here keeps
 * routing consistent regardless of which path resolves a file.
 *
 * Semantics:
 * - a single star matches any run of characters within one path segment
 * - a double star followed by a slash matches zero or more leading directory
 *   segments, so "double-star/slash/star.json" matches both "a.json" and
 *   "nested/a.json"
 * - a bare double star matches any run of characters across segments
 * - "?" matches a single non-separator character
 */

export function matchesAny(path: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => matchGlob(pattern, path));
}

export function matchGlob(pattern: string, path: string): boolean {
  return globToRegExp(normalizeWorkspacePath(pattern)).test(normalizeWorkspacePath(path));
}

export function normalizeWorkspacePath(path: string, sep = "/"): string {
  const normalized = path.split(sep).join("/");
  return normalized.replace(/^\.\//, "").replace(/^\/+/, "");
}

export function globToRegExp(pattern: string): RegExp {
  let source = "^";

  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === undefined) continue;
    const next = pattern[index + 1];
    const afterNext = pattern[index + 2];

    if (char === "*" && next === "*" && afterNext === "/") {
      source += "(?:.*/)?";
      index += 2;
      continue;
    }

    if (char === "*" && next === "*") {
      source += ".*";
      index += 1;
      continue;
    }

    if (char === "*") {
      source += "[^/]*";
      continue;
    }

    if (char === "?") {
      source += "[^/]";
      continue;
    }

    source += escapeRegExp(char);
  }

  return new RegExp(`${source}$`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
