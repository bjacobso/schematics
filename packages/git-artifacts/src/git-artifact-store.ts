import {
  ArtifactRef,
  loadedEntry,
  pendingEntry,
  type ArtifactContent,
  type ArtifactRefDefinition,
  type ArtifactStore,
  type ArtifactStoreEntry,
  type ArtifactStoreError,
  type ArtifactStoreEvent,
} from "@schematics/artifacts";
import { Effect, Queue, Stream } from "effect";
import type { GitError } from "./errors";
import type { GitAuthor, GitCommitInfo, GitRepoBackend, Oid } from "./git-repo-backend";
import {
  buildGitCommitMessage,
  gitActorEmail,
  gitActorName,
  type GitArtifactActor,
} from "./trailers";
import { currentGitTimestamp } from "./clock";

const ENC = new TextEncoder();
const DEC = new TextDecoder();

export interface GitCommitOptions {
  readonly message: string;
  readonly actor?: GitArtifactActor | undefined;
  readonly author?: GitAuthor | undefined;
  readonly turnId?: string | undefined;
  readonly toolCallId?: string | undefined;
  /** Unix seconds for the commit author/committer when `author` is omitted. */
  readonly timestamp?: number | undefined;
  /** Push to the remote after committing (default: push when a remote exists). */
  readonly push?: boolean | undefined;
}

/**
 * Layer 3 — an {@link ArtifactStore} backed by a git repo (Cloudflare Artifacts
 * in prod, a local checkout otherwise). Maps `ProjectFile`/`Path` refs to tree
 * paths and `GitBlob` refs to content-addressed blobs, hydrating lazily like the
 * HydratingArtifactStore. Changes stage into the index; `commit` turns the
 * staged index into a durable git commit (and pushes).
 */
export interface GitArtifactStore extends ArtifactStore {
  /** Fetch (shallow) + list the tree into pending entries. Returns the refs. */
  readonly seed: Effect.Effect<readonly ArtifactRefDefinition[], ArtifactStoreError>;
  /** Turn the staged index into a git commit (+ push). Returns the commit oid. */
  readonly commit: (options: GitCommitOptions) => Effect.Effect<Oid, GitError>;
  /** Commit log for the branch, newest first. */
  readonly log: (limit?: number) => Effect.Effect<readonly GitCommitInfo[], GitError>;
  /** The current HEAD commit oid, or `null` before the first commit. */
  readonly head: Effect.Effect<Oid | null, GitError>;
  /** Whether the working index has staged changes not yet committed. */
  readonly hasUncommittedChanges: Effect.Effect<boolean>;
}

export interface GitArtifactStoreOptions {
  readonly backend: GitRepoBackend;
  readonly projectId?: string | undefined;
  /** Treat these path globs/extensions as binary (returned as `Uint8Array`). */
  readonly isBinaryPath?: ((path: string) => boolean) | undefined;
  /** Default author for commits that don't supply one. */
  readonly defaultAuthor?: GitAuthor | undefined;
  /** Whether a remote is configured (controls default push + fetch-on-seed). */
  readonly hasRemote?: boolean | undefined;
}

interface TreeEntry {
  oid: Oid | null; // committed blob oid; null once staged-but-uncommitted
  content?: ArtifactContent | undefined; // hydrated/staged content
}

const DEFAULT_BINARY = /\.(?:pdf|png|jpe?g|gif|webp|wasm|zip|woff2?)$/i;

export function makeGitArtifactStore(options: GitArtifactStoreOptions): GitArtifactStore {
  const { backend, projectId } = options;
  const isBinary = options.isBinaryPath ?? ((path: string) => DEFAULT_BINARY.test(path));
  const hasRemote = options.hasRemote ?? false;

  const tree = new Map<string, TreeEntry>();
  const subscribers = new Set<(event: ArtifactStoreEvent) => void>();
  let headCommit: Oid | null = null;
  let dirty = false;

  const publish = (event: ArtifactStoreEvent) => {
    for (const subscriber of subscribers) subscriber(event);
  };

  const fileRef = (path: string): ArtifactRefDefinition => ArtifactRef.projectFile(path, projectId);

  const pathOf = (ref: ArtifactRefDefinition): string | null => {
    if (ref._tag === "ProjectFile" || ref._tag === "Path") return ref.path;
    return null;
  };

  const decode = (path: string, bytes: Uint8Array): ArtifactContent =>
    isBinary(path) ? bytes : DEC.decode(bytes);

  const encode = (content: ArtifactContent): Uint8Array =>
    typeof content === "string" ? ENC.encode(content) : content;

  const storeError = (
    reason: ArtifactStoreError["reason"],
    ref: ArtifactRefDefinition,
  ): ArtifactStoreError => ({ _tag: "ArtifactStoreError", reason, ref });

  /** Unexpected git failures become defects — they aren't `not-found`/`exists`. */
  const orDieGit = <A>(effect: Effect.Effect<A, GitError>): Effect.Effect<A> =>
    effect.pipe(Effect.orDie);

  const seed: GitArtifactStore["seed"] = Effect.gen(function* () {
    const commit = yield* orDieGit(
      hasRemote ? backend.fetch().pipe(Effect.map((r) => r.commit)) : backend.head,
    );
    headCommit = commit;
    tree.clear();
    if (commit) {
      const entries = yield* orDieGit(backend.listTree(commit));
      for (const entry of entries) {
        tree.set(entry.path, { oid: entry.oid });
        publish({ type: "created", ref: fileRef(entry.path) });
      }
    }
    return [...tree.keys()].map(fileRef);
  });

  const readPath = (path: string, ref: ArtifactRefDefinition) =>
    Effect.gen(function* () {
      const entry = tree.get(path);
      if (!entry) return yield* Effect.fail(storeError("not-found", ref));
      if (entry.content !== undefined) return entry.content;
      if (!entry.oid) return yield* Effect.fail(storeError("not-found", ref));
      const bytes = yield* orDieGit(backend.readBlob(entry.oid));
      const content = decode(path, bytes);
      entry.content = content;
      publish({ type: "hydrated", ref });
      return content;
    });

  const read: ArtifactStore["read"] = (ref) => {
    if (ref._tag === "GitBlob") {
      return orDieGit(backend.readBlob(ref.oid)).pipe(
        Effect.map((bytes) => bytes as ArtifactContent),
      );
    }
    const path = pathOf(ref);
    if (path === null) return Effect.fail(storeError("unsupported-ref", ref));
    return readPath(path, ref);
  };

  const write: ArtifactStore["write"] = (ref, content) => {
    const path = pathOf(ref);
    if (path === null) return Effect.fail(storeError("unsupported-ref", ref));
    return Effect.gen(function* () {
      const existed = tree.has(path);
      if (!existed) return yield* Effect.fail(storeError("not-found", ref));
      yield* orDieGit(backend.stage(path, encode(content)));
      tree.set(path, { oid: null, content });
      dirty = true;
      publish({ type: "updated", ref });
    });
  };

  const create: ArtifactStore["create"] = (ref, content) => {
    const path = pathOf(ref);
    if (path === null) return Effect.fail(storeError("unsupported-ref", ref));
    return Effect.gen(function* () {
      if (tree.has(path)) return yield* Effect.fail(storeError("already-exists", ref));
      yield* orDieGit(backend.stage(path, encode(content)));
      tree.set(path, { oid: null, content });
      dirty = true;
      publish({ type: "created", ref });
      return ref;
    });
  };

  const del: ArtifactStore["delete"] = (ref) => {
    const path = pathOf(ref);
    if (path === null) return Effect.fail(storeError("unsupported-ref", ref));
    return Effect.gen(function* () {
      if (!tree.has(path)) return yield* Effect.fail(storeError("not-found", ref));
      yield* orDieGit(backend.remove(path));
      tree.delete(path);
      dirty = true;
      publish({ type: "deleted", ref });
    });
  };

  const commit: GitArtifactStore["commit"] = (commitOptions) =>
    Effect.gen(function* () {
      const configuredAuthor = commitOptions.author ?? options.defaultAuthor;
      const author = configuredAuthor ?? {
        name: gitActorName(commitOptions.actor),
        email: gitActorEmail(commitOptions.actor),
        timestamp: commitOptions.timestamp ?? (yield* currentGitTimestamp),
      };
      const message = buildGitCommitMessage(commitOptions.message, commitOptions);
      const oid = yield* backend.commit(message, author);
      if (commitOptions.push ?? hasRemote) yield* backend.push;
      headCommit = oid;
      dirty = false;
      // Staged content is now committed; drop the null-oid markers so future
      // reads resolve through the new tree on next seed if needed.
      return oid;
    });

  return {
    seed,
    commit,
    log: (limit) => backend.log(limit),
    head: Effect.sync(() => headCommit),
    hasUncommittedChanges: Effect.sync(() => dirty),

    list: Effect.sync(() => [...tree.keys()].map(fileRef)),

    entries: Effect.sync(() =>
      [...tree.entries()].map(
        ([path, entry]): ArtifactStoreEntry =>
          entry.content !== undefined
            ? loadedEntry(fileRef(path), entry.content)
            : pendingEntry(fileRef(path)),
      ),
    ),

    read,
    write,
    create,
    delete: del,

    watch: Stream.callback<ArtifactStoreEvent>((queue) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          const subscriber = (event: ArtifactStoreEvent) => Queue.offerUnsafe(queue, event);
          subscribers.add(subscriber);
          return subscriber;
        }),
        (subscriber) => Effect.sync(() => subscribers.delete(subscriber)),
      ),
    ),
  };
}
