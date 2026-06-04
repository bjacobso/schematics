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
export { currentGitTimestamp, currentIsoTimestamp, fixedClock, fixedClockFromIso } from "./clock";
export {
  buildGitCommitMessage,
  gitActorEmail,
  gitActorName,
  gitTrailerLines,
  parseGitCommitTrailers,
} from "./trailers";
export type { GitArtifactActor, GitCommitTrailerOptions, GitCommitTrailers } from "./trailers";
import {
  makeGitRepoBackend,
  type GitAuthor,
  type GitCommitInfo,
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

export interface LocalGitFileChange {
  readonly path: string;
  readonly status: "added" | "modified" | "deleted";
  readonly beforeContent: string | null;
  readonly afterContent: string | null;
}

export interface LocalGitCommitInfo extends GitCommitInfo {
  readonly changes: readonly LocalGitFileChange[];
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
  /** Commit log for the configured branch, newest first. */
  readonly log: (limit?: number) => Effect.Effect<readonly LocalGitCommitInfo[], GitError>;
  /** The git repo root that paths are resolved against. */
  readonly root: string;
}

export interface MakeLocalGitCommitterOptions {
  /** The served project directory (may be a subdir of the repo root). */
  readonly directory: string;
  /** Pin commits/logs to a branch. Omit to follow the currently checked-out branch. */
  readonly branch?: string | undefined;
}

export interface LocalGitForkOptions {
  readonly directory: string;
  readonly branch: string;
  readonly from?: string | undefined;
  readonly checkout?: boolean | undefined;
  readonly force?: boolean | undefined;
}

export interface LocalGitForkResult {
  readonly branch: string;
  readonly oid: Oid;
}

export interface LocalGitMergeOptions {
  readonly directory: string;
  readonly branch: string;
  readonly into?: string | undefined;
}

export interface LocalGitMergeResult {
  readonly branch: string;
  readonly into: string;
  readonly oid: Oid | null;
  readonly fastForward: boolean;
  readonly alreadyMerged: boolean;
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
  const explicitBranch = options.branch ? normalizeBranchName(options.branch) : null;
  const prefix = nodePath.relative(root, nodePath.resolve(options.directory));
  const toRepoPath = (workspacePath: string): string =>
    (prefix ? nodePath.join(prefix, workspacePath) : workspacePath).split(nodePath.sep).join("/");
  const fromRepoPath = (repoPath: string): string | null => {
    if (!prefix) return repoPath;
    const normalizedPrefix = prefix.split(nodePath.sep).join("/");
    if (!repoPath.startsWith(`${normalizedPrefix}/`)) return null;
    return repoPath.slice(normalizedPrefix.length + 1);
  };

  return {
    root,
    commit: (commitOptions) =>
      Effect.tryPromise({
        try: async () => {
          const ref = await localBranchRef(root, explicitBranch);
          const filepaths = [
            ...commitOptions.changed.map(toRepoPath),
            ...(commitOptions.deleted ?? []).map(toRepoPath),
          ];
          for (const path of commitOptions.changed) {
            await git.add({ fs, dir: root, filepath: toRepoPath(path) });
          }
          for (const path of commitOptions.deleted ?? []) {
            await git.remove({ fs, dir: root, filepath: toRepoPath(path) }).catch(() => undefined);
          }
          const status = await git.statusMatrix({ fs, dir: root, ref, filepaths });
          const hasStagedChange = status.some(([, head, , stage]) => head !== stage);
          if (!hasStagedChange) return null;
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
    log: (limit) =>
      Effect.tryPromise({
        try: async () => {
          const ref = await localBranchRef(root, explicitBranch);
          const commits = await git.log({ fs, dir: root, ref, ...(limit ? { depth: limit } : {}) });
          return Promise.all(
            commits.map(async (entry) => ({
              oid: entry.oid,
              message: entry.commit.message,
              parents: entry.commit.parent,
              author: {
                name: entry.commit.author.name,
                email: entry.commit.author.email,
                timestamp: entry.commit.author.timestamp,
              },
              changes: await commitChanges({
                root,
                ref: entry.oid,
                parentRef: entry.commit.parent[0] ?? null,
                fromRepoPath,
              }),
            })),
          );
        },
        catch: gitError("log"),
      }),
  };
}

export function forkLocalGitBranch(
  options: LocalGitForkOptions,
): Effect.Effect<LocalGitForkResult, GitError> {
  return Effect.tryPromise({
    try: async () => {
      const root = requireGitRoot(options.directory);
      const branch = normalizeBranchName(options.branch);
      await git.branch({
        fs,
        dir: root,
        ref: branch,
        object: options.from ?? "HEAD",
        checkout: options.checkout ?? true,
        force: options.force ?? false,
      });
      if (options.checkout ?? true) {
        await git.checkout({ fs, dir: root, ref: branch });
      }
      const oid = await git.resolveRef({ fs, dir: root, ref: `refs/heads/${branch}` });
      return { branch, oid };
    },
    catch: gitError("fork"),
  });
}

export function mergeLocalGitBranch(
  options: LocalGitMergeOptions,
): Effect.Effect<LocalGitMergeResult, GitError> {
  return Effect.tryPromise({
    try: async () => {
      const root = requireGitRoot(options.directory);
      const branch = normalizeBranchName(options.branch);
      const into = normalizeBranchName(options.into ?? "main");
      const intoRef = `refs/heads/${into}`;
      const branchRef = `refs/heads/${branch}`;
      const intoHead = await git.resolveRef({ fs, dir: root, ref: intoRef });
      const branchHead = await git.resolveRef({ fs, dir: root, ref: branchRef });
      if (await isAncestor(root, branchHead, intoHead)) {
        await git.checkout({ fs, dir: root, ref: into });
        return {
          branch,
          into,
          oid: intoHead,
          fastForward: false,
          alreadyMerged: true,
        };
      }
      if (!(await isAncestor(root, intoHead, branchHead))) {
        await git.checkout({ fs, dir: root, ref: into });
        throw new Error(
          [
            `Cannot fast-forward merge ${branch} into ${into}.`,
            `${into} and ${branch} have diverged; run plan/pull to inspect remote drift or resolve the git conflict before merging.`,
          ].join(" "),
        );
      }
      await git.checkout({ fs, dir: root, ref: into });
      const result = await git.merge({
        fs,
        dir: root,
        ours: into,
        theirs: branch,
        fastForwardOnly: true,
        abortOnConflict: true,
      });
      await git.checkout({ fs, dir: root, ref: into });
      return {
        branch,
        into,
        oid: result.oid ?? (await git.resolveRef({ fs, dir: root, ref: `refs/heads/${into}` })),
        fastForward: result.fastForward ?? false,
        alreadyMerged: result.alreadyMerged ?? false,
      };
    },
    catch: gitError("merge"),
  });
}

function requireGitRoot(directory: string): string {
  const root = findGitRoot(directory);
  if (!root) throw new Error(`Directory is not inside a git repository: ${directory}`);
  return root;
}

async function localBranchRef(root: string, explicitBranch: string | null): Promise<string> {
  if (explicitBranch) return `refs/heads/${explicitBranch}`;
  const current = await git.currentBranch({ fs, dir: root, fullname: false });
  return `refs/heads/${current ?? "main"}`;
}

function normalizeBranchName(branch: string): string {
  const normalized = branch.trim().replace(/^refs\/heads\//, "");
  if (!normalized) throw new Error("Branch name cannot be empty.");
  return normalized;
}

async function isAncestor(root: string, ancestor: string, descendant: string): Promise<boolean> {
  const commits = await git.log({ fs, dir: root, ref: descendant });
  return commits.some((entry) => entry.oid === ancestor);
}

async function commitChanges({
  root,
  ref,
  parentRef,
  fromRepoPath,
}: {
  readonly root: string;
  readonly ref: string;
  readonly parentRef: string | null;
  readonly fromRepoPath: (repoPath: string) => string | null;
}): Promise<readonly LocalGitFileChange[]> {
  const changes: LocalGitFileChange[] = [];
  await git.walk({
    fs,
    dir: root,
    trees: parentRef ? [git.TREE({ ref: parentRef }), git.TREE({ ref })] : [git.TREE({ ref })],
    map: async (filepath, entries) => {
      if (filepath === ".") return;
      const path = fromRepoPath(filepath);
      if (!path) return;
      const beforeEntry = parentRef ? entries[0] : undefined;
      const afterEntry = parentRef ? entries[1] : entries[0];
      const before = await readWalkEntry(root, beforeEntry);
      const after = await readWalkEntry(root, afterEntry);
      if (!before && !after) return;
      if (before?.oid && after?.oid && before.oid === after.oid) return;

      changes.push({
        path,
        status: !before ? "added" : !after ? "deleted" : "modified",
        beforeContent: before?.content ?? null,
        afterContent: after?.content ?? null,
      });
    },
  });
  return changes.sort((left, right) => left.path.localeCompare(right.path));
}

async function readWalkEntry(
  root: string,
  entry: git.WalkerEntry | null | undefined,
): Promise<{ readonly oid: string; readonly content: string } | null> {
  if (!entry) return null;
  const type = await entry.type().catch(() => null);
  if (type !== "blob") return null;
  const oid = await entry.oid();
  const { blob } = await git.readBlob({ fs, dir: root, oid });
  return { oid, content: new TextDecoder().decode(blob) };
}
