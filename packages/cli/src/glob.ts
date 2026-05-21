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

function globToRegExp(pattern: string): RegExp {
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
