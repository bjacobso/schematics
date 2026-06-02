import type { SchemaIssue } from "effect";
import type { ArtifactRef } from "./ref";

export interface ArtifactTypeNotFound {
  readonly _tag: "ArtifactTypeNotFound";
  readonly ref: ArtifactRef;
}

export interface ArtifactViewNotFound {
  readonly _tag: "ArtifactViewNotFound";
  readonly ref: ArtifactRef;
  readonly view: string;
  readonly type?: string | undefined;
}

export interface ArtifactHandlerNotFound {
  readonly _tag: "ArtifactHandlerNotFound";
  readonly ref: ArtifactRef;
  readonly view: string;
  readonly type: string;
}

export interface ArtifactHandlerFailed {
  readonly _tag: "ArtifactHandlerFailed";
  readonly view: string;
  readonly error: unknown;
}

export interface ArtifactSchemaValidationError {
  readonly _tag: "ArtifactSchemaValidationError";
  readonly phase: "input" | "output" | "error";
  readonly view: string;
  readonly message: string;
  readonly issue?: SchemaIssue.Issue | undefined;
}

export interface ArtifactUnexpectedInput {
  readonly _tag: "ArtifactUnexpectedInput";
  readonly view: string;
}

export type ArtifactRegistryError =
  | ArtifactTypeNotFound
  | ArtifactViewNotFound
  | ArtifactHandlerNotFound
  | ArtifactHandlerFailed
  | ArtifactSchemaValidationError
  | ArtifactUnexpectedInput;
