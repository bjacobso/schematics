import { Schema } from "effect";
import { RelationAnnotationKey } from "./annotations";
import type { RelationRefAnnotation, RelationScope } from "./types";

export interface RelationIdOptions {
  readonly scope?: RelationScope | undefined;
  readonly display?: string | readonly string[] | undefined;
}

export interface RelationRefOptions {
  readonly scope?: RelationScope | undefined;
  readonly scopedBy?: string | readonly string[] | undefined;
}

export function id(type: string, options: RelationIdOptions = {}) {
  return Schema.String.annotations({
    [RelationAnnotationKey]: {
      kind: "id",
      type,
      scope: options.scope,
      display: normalizePathOption(options.display),
    },
  });
}

export function ref(target: string, options: RelationRefOptions = {}) {
  return Schema.String.annotations({
    [RelationAnnotationKey]: {
      kind: "ref",
      target,
      scope: options.scope,
      scopedBy: normalizePathOption(options.scopedBy),
    } satisfies RelationRefAnnotation,
  });
}

export function refs(target: string, options: RelationRefOptions = {}) {
  return Schema.Array(ref(target, options));
}

export function parent(type: string): RelationScope {
  return { kind: "parent", type };
}

export function path(path: string | readonly string[]): RelationScope {
  return { kind: "path", path: normalizePath(path) };
}

export function key(path: string | readonly string[]): readonly string[] {
  return normalizePath(path);
}

function normalizePathOption(
  path: string | readonly string[] | undefined,
): readonly string[] | undefined {
  return path === undefined ? undefined : normalizePath(path);
}

function normalizePath(path: string | readonly string[]): readonly string[] {
  return typeof path === "string" ? path.split(".").filter(Boolean) : path;
}
