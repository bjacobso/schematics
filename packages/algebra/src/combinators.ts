import { Schema } from "effect";
import { RelationAnnotationKey } from "./annotations";
import type {
  RelationDerivedIdAnnotation,
  RelationIdAnnotation,
  RelationRefAnnotation,
  RelationScope,
} from "./types";

export interface RelationIdOptions {
  readonly scope?: RelationScope | undefined;
  readonly display?: string | readonly string[] | undefined;
}

export interface RelationDerivedIdOptions extends RelationIdOptions {
  readonly id: string | readonly string[];
  readonly scopedBy?: string | readonly string[] | undefined;
}

export interface RelationRefOptions {
  readonly scope?: RelationScope | undefined;
  readonly scopedBy?: string | readonly string[] | undefined;
  readonly edge?: string | undefined;
}

export function id(type: string, options: RelationIdOptions = {}) {
  return Schema.String.annotate({
    [RelationAnnotationKey]: {
      kind: "id",
      type,
      scope: options.scope,
      display: normalizePathOption(options.display),
    } satisfies RelationIdAnnotation,
  });
}

export function derivedId<A>(
  schema: Schema.Schema<A>,
  type: string,
  options: RelationDerivedIdOptions,
): Schema.Schema<A> {
  return schema.annotate({
    [RelationAnnotationKey]: {
      kind: "derived-id",
      type,
      id: normalizePath(options.id),
      scope: options.scope,
      scopedBy: normalizePathOption(options.scopedBy),
      display: normalizePathOption(options.display),
    } satisfies RelationDerivedIdAnnotation,
  });
}

export function ref(target: string, options: RelationRefOptions = {}) {
  return Schema.String.annotate({
    [RelationAnnotationKey]: {
      kind: "ref",
      target,
      scope: options.scope,
      scopedBy: normalizePathOption(options.scopedBy),
      edge: options.edge,
      valueKind: "id",
    } satisfies RelationRefAnnotation,
  });
}

export function refs(target: string, options: RelationRefOptions = {}) {
  return Schema.Array(ref(target, options));
}

export function pathRef(target: string, options: RelationRefOptions = {}) {
  return Schema.String.annotate({
    [RelationAnnotationKey]: {
      kind: "ref",
      target,
      scope: options.scope,
      scopedBy: normalizePathOption(options.scopedBy),
      edge: options.edge,
      valueKind: "path",
    } satisfies RelationRefAnnotation,
  });
}

export function pathRefs(target: string, options: RelationRefOptions = {}) {
  return Schema.Array(pathRef(target, options));
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
  if (typeof path !== "string") return path;
  return path.includes("/") ? path.split("/").filter(Boolean) : path.split(".").filter(Boolean);
}
