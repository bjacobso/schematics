/**
 * Schema-value diffing. We diff the *encoded wire* form (plain JSON-shaped
 * values produced by the schema), not file text — so the result is stable
 * against key ordering, comments, and whitespace, and is field-aware.
 */

/** A single field-level change between two wire values. */
export interface FieldChange {
  /** Dotted path to the field, or "(root)" for a top-level scalar/array swap. */
  readonly path: string;
  readonly before: unknown;
  readonly after: unknown;
}

/** Canonical stringification with recursively sorted object keys. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/** Stable identity hash of a wire value, used for optimistic-concurrency checks. */
export function hashValue(value: unknown): string {
  return stableStringify(value);
}

/** Deep structural equality on wire values. */
export function valuesEqual(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}

/** Field-level diff. Arrays are treated atomically (a whole-array swap). */
export function diffValues(before: unknown, after: unknown): readonly FieldChange[] {
  const changes: FieldChange[] = [];
  walk(before, after, "", changes);
  return changes;
}

function walk(before: unknown, after: unknown, path: string, changes: FieldChange[]): void {
  if (valuesEqual(before, after)) return;

  if (isPlainObject(before) && isPlainObject(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of [...keys].sort()) {
      walk(before[key], after[key], path ? `${path}.${key}` : key, changes);
    }
    return;
  }

  changes.push({ path: path === "" ? "(root)" : path, before, after });
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const entry = value[key];
      if (entry !== undefined) out[key] = canonicalize(entry);
    }
    return out;
  }
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
