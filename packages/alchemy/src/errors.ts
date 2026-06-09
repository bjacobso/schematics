import { Data } from "effect";

export type ProviderOperation = "list" | "read" | "create" | "update" | "delete";

/**
 * Raised when a {@link ResourceHandler} call against the remote API fails. This
 * is the engine's only "cloud" failure channel — every provider verb returns it.
 */
export class ProviderError extends Data.TaggedError("ProviderError")<{
  readonly kind: string;
  readonly operation: ProviderOperation;
  readonly key?: string | undefined;
  readonly message: string;
  readonly cause?: unknown;
}> {}

/** A single desired-state file that failed to parse or validate during `plan`. */
export interface ConfigValidationIssue {
  readonly kind: string;
  readonly path: string;
  readonly message: string;
}

/**
 * Raised by `plan` when one or more desired-state files are invalid. Plan fails
 * with this *before* any provider call, so we never apply unvalidated config.
 */
export class ConfigValidationError extends Data.TaggedError("ConfigValidationError")<{
  readonly issues: readonly ConfigValidationIssue[];
}> {}

/** Raised when the configured codec cannot parse or stringify a file. */
export class ConfigCodecError extends Data.TaggedError("ConfigCodecError")<{
  readonly path: string;
  readonly operation: "parse" | "stringify";
  readonly message: string;
}> {}
