import * as fs from "node:fs";
import * as nodePath from "node:path";
import * as git from "isomorphic-git";
import { Effect } from "effect";
import { gitError, type GitError } from "./errors";
import {
  makeGitArtifactStore,
  type GitArtifactStore,
  type GitArtifactStoreOptions,
} from "./git-artifact-store";
import {
  makeGitRepoBackend,
  type GitAuthor,
  type GitRepoBackend,
  type Oid,
} from "./git-repo-backend";

/**
 * Walk up from `startDir` looking for a `.git` directory. Returns the repo root
 * (the working-tree root isomorphic-git operates on), or `null` if `startDir`
 * is not inside a git repo.
 */
export function findGitRoot(startDir: string): string | null {
  let current = nodePath.resolve(startDir);
  for (;;) {
    if (fs.existsSync(nodePath.join(current, ".git"))) return current;
    const parent = nodePath.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export interface NodeGitRepoBackendOptions {
  /** Working-tree root (must contain `.git`). Use {@link findGitRoot}. */
  readonly dir: string;
  readonly branch?: string | undefined;
}

/** A {@link GitRepoBackend} backed by the real on-disk repo at `dir` via `node:fs`. */
export function makeNodeGitRepoBackend(options: NodeGitRepoBackendOptions): GitRepoBackend {
  return makeGitRepoBackend({
    fs,
    dir: options.dir,
    ...(options.branch ? { branch: options.branch } : {}),
  });
}

export interface LocalGitArtifactStoreOptions extends Omit<
  GitArtifactStoreOptions,
  "backend" | "hasRemote"
> {
  readonly dir: string;
  readonly branch?: string | undefined;
}

/**
 * A {@link GitArtifactStore} over a local checkout — real `git commit`s land in
 * the repo's history, no remote. Returns `null` when `dir` is not in a git repo.
 */
export function makeLocalGitArtifactStore(
  options: LocalGitArtifactStoreOptions,
): GitArtifactStore | null {
  const root = findGitRoot(options.dir);
  if (!root) return null;
  const backend = makeNodeGitRepoBackend({
    dir: root,
    ...(options.branch ? { branch: options.branch } : {}),
  });
  return makeGitArtifactStore({
    backend,
    hasRemote: false,
    ...(options.projectId ? { projectId: options.projectId } : {}),
    ...(options.isBinaryPath ? { isBinaryPath: options.isBinaryPath } : {}),
    ...(options.defaultAuthor ? { defaultAuthor: options.defaultAuthor } : {}),
  });
}

/** Convenience: is `dir` inside a git repo? */
export const isInsideGitRepo = (dir: string): Effect.Effect<boolean> =>
  Effect.sync(() => findGitRoot(dir) !== null);

export interface CommitWorkingTreeOptions {
  /** Workspace-relative paths whose on-disk content changed (created/updated). */
  readonly changed: readonly string[];
  /** Workspace-relative paths removed from disk. */
  readonly deleted?: readonly string[] | undefined;
  readonly message: string;
  readonly author: GitAuthor;
}

/**
 * Commits files already written to the working tree — the local-IDE path. The
 * CLI writes files to disk itself; this stages those exact paths and records a
 * real `git commit`, so an in-repo workspace gets durable, inspectable history
 * using the same git the developer already uses. Returns the commit oid, or
 * `null` if there was nothing to commit.
 */
export interface LocalGitCommitter {
  readonly commit: (options: CommitWorkingTreeOptions) => Effect.Effect<Oid | null, GitError>;
  /** The git repo root that paths are resolved against. */
  readonly root: string;
}

export interface MakeLocalGitCommitterOptions {
  /** The served project directory (may be a subdir of the repo root). */
  readonly directory: string;
  readonly branch?: string | undefined;
}

/**
 * Build a {@link LocalGitCommitter} for `directory`, or `null` when it is not
 * inside a git repo. Workspace paths are rewritten relative to the repo root so
 * a project served from a subdirectory still commits to the right tree paths.
 */
export function makeLocalGitCommitter(
  options: MakeLocalGitCommitterOptions,
): LocalGitCommitter | null {
  const root = findGitRoot(options.directory);
  if (!root) return null;
  const ref = `refs/heads/${options.branch ?? "main"}`;
  const prefix = nodePath.relative(root, nodePath.resolve(options.directory));
  const toRepoPath = (workspacePath: string): string =>
    (prefix ? nodePath.join(prefix, workspacePath) : workspacePath).split(nodePath.sep).join("/");

  return {
    root,
    commit: (commitOptions) =>
      Effect.tryPromise({
        try: async () => {
          for (const path of commitOptions.changed) {
            await git.add({ fs, dir: root, filepath: toRepoPath(path) });
          }
          for (const path of commitOptions.deleted ?? []) {
            await git.remove({ fs, dir: root, filepath: toRepoPath(path) }).catch(() => undefined);
          }
          return git.commit({
            fs,
            dir: root,
            ref,
            message: commitOptions.message,
            author: {
              name: commitOptions.author.name,
              email: commitOptions.author.email,
              timestamp: commitOptions.author.timestamp,
              timezoneOffset: commitOptions.author.timezoneOffset ?? 0,
            },
          });
        },
        catch: gitError("commit"),
      }),
  };
}
