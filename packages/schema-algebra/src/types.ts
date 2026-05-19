import type { Schema } from "effect";

export type AnySchema = Schema.Schema.AnyNoContext;

export type RelationKind = "id" | "ref";

export interface RelationParentScope {
  readonly kind: "parent";
  readonly type: string;
}

export interface RelationPathScope {
  readonly kind: "path";
  readonly path: readonly string[];
}

export type RelationScope = RelationParentScope | RelationPathScope;

export interface RelationIdAnnotation {
  readonly kind: "id";
  readonly type: string;
  readonly scope?: RelationScope | undefined;
  readonly display?: readonly string[] | undefined;
}

export interface RelationRefAnnotation {
  readonly kind: "ref";
  readonly target: string;
  readonly scope?: RelationScope | undefined;
  readonly scopedBy?: readonly string[] | undefined;
}

export type RelationAnnotation = RelationIdAnnotation | RelationRefAnnotation;

export interface RelationDefinition {
  readonly type: string;
  readonly id: string;
  readonly path: readonly string[];
  readonly scope?: string | undefined;
  readonly display?: string | undefined;
}

export interface RelationReference {
  readonly target: string;
  readonly id: string;
  readonly path: readonly string[];
  readonly scope?: string | undefined;
  readonly scopedBy?: readonly string[] | undefined;
}

export interface RelationGraph {
  readonly definitions: readonly RelationDefinition[];
  readonly references: readonly RelationReference[];
}

export interface RelationDiagnostic {
  readonly severity: "error" | "warning" | "info";
  readonly code: "duplicate-id" | "unresolved-ref" | "invalid-relation-value";
  readonly path: readonly string[];
  readonly message: string;
  readonly relation: RelationDefinition | RelationReference;
}
