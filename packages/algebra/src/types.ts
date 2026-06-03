import type { SchemaAST } from "effect";

export interface AnySchema {
  readonly ast: SchemaAST.AST;
}

export type RelationKind = "id" | "derived-id" | "ref";

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

export interface RelationDerivedIdAnnotation {
  readonly kind: "derived-id";
  readonly type: string;
  readonly id: readonly string[];
  readonly scope?: RelationScope | undefined;
  readonly scopedBy?: readonly string[] | undefined;
  readonly display?: readonly string[] | undefined;
}

export interface RelationRefAnnotation {
  readonly kind: "ref";
  readonly target: string;
  readonly scope?: RelationScope | undefined;
  readonly scopedBy?: readonly string[] | undefined;
  readonly edge?: string | undefined;
  readonly valueKind?: "id" | "path" | undefined;
}

export type RelationAnnotation =
  | RelationIdAnnotation
  | RelationDerivedIdAnnotation
  | RelationRefAnnotation;

export interface RelationDefinition {
  readonly type: string;
  readonly id: string;
  readonly path: readonly string[];
  readonly scope?: string | undefined;
  readonly display?: string | undefined;
  readonly derived?: boolean | undefined;
}

export interface RelationReference {
  readonly target: string;
  readonly id: string;
  readonly path: readonly string[];
  readonly scope?: string | undefined;
  readonly scopedBy?: readonly string[] | undefined;
  readonly edge?: string | undefined;
  readonly valueKind?: "id" | "path" | undefined;
}

export interface RelationGraph {
  readonly definitions: readonly RelationDefinition[];
  readonly references: readonly RelationReference[];
}

export interface RelationEntityIndexEntry {
  readonly type: string;
  readonly id: string;
  readonly scope?: string | undefined;
  readonly definitions: readonly RelationDefinition[];
}

export type RelationEntityIndex = readonly RelationEntityIndexEntry[];

export interface RelationDiagnostic {
  readonly severity: "error" | "warning" | "info";
  readonly code: "duplicate-id" | "unresolved-ref" | "invalid-relation-value";
  readonly path: readonly string[];
  readonly message: string;
  readonly relation: RelationDefinition | RelationReference;
}

export interface RelationPatchSuggestion {
  readonly kind: "create-definition";
  readonly target: string;
  readonly id: string;
  readonly path: readonly string[];
  readonly message: string;
  readonly scope?: string | undefined;
  readonly reference: RelationReference;
}
