import { Data } from "effect";

/** A failure in the isomorphic-git plumbing layer (fetch/commit/push/read). */
export class GitError extends Data.TaggedError("GitError")<{
  readonly op: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

/** A failure in the repo-management port (create/token/delete a repo). */
export class ArtifactsError extends Data.TaggedError("ArtifactsError")<{
  readonly op: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

export const gitError =
  (op: string) =>
  (cause: unknown): GitError =>
    new GitError({ op, message: cause instanceof Error ? cause.message : String(cause), cause });

export const artifactsError =
  (op: string) =>
  (cause: unknown): ArtifactsError =>
    new ArtifactsError({
      op,
      message: cause instanceof Error ? cause.message : String(cause),
      cause,
    });
