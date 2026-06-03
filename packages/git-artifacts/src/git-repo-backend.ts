import * as git from "isomorphic-git";
import { Effect } from "effect";
import { gitError, type GitError } from "./errors";
import { memFsDirname } from "./mem-fs";

export type Oid = string;

export interface GitAuthor {
  readonly name: string;
  readonly email: string;
  /** Unix seconds. Pass it in so the backend never reaches for a wall clock. */
  readonly timestamp: number;
  readonly timezoneOffset?: number | undefined;
}

export interface GitTreeEntry {
  readonly path: string;
  readonly oid: Oid;
  readonly mode: string;
}

export interface GitCommitInfo {
  readonly oid: Oid;
  readonly message: string;
  readonly parents: readonly Oid[];
  readonly author: { readonly name: string; readonly email: string; readonly timestamp: number };
}

/**
 * Pure git plumbing — no `ArtifactStore` concepts. Content is `Uint8Array`
 * end-to-end (git is binary-native). The same backend runs against the
 * in-memory FS in a Worker/tests and against Node's `fs` for a local checkout.
 */
export interface GitRepoBackend {
  /** Initialize an empty repo at `dir` on the configured branch. */
  readonly init: Effect.Effect<void, GitError>;
  /** Shallow-fetch (default depth 1) the branch from the remote. Returns HEAD oid. */
  readonly fetch: (depth?: number) => Effect.Effect<{ readonly commit: Oid }, GitError>;
  /** Clone the branch fresh from the remote into `dir`. Returns HEAD oid. */
  readonly clone: (depth?: number) => Effect.Effect<{ readonly commit: Oid }, GitError>;
  /** Resolve the current branch HEAD, or `null` if the branch has no commits. */
  readonly head: Effect.Effect<Oid | null, GitError>;
  /** List every blob in a commit's tree as `{ path, oid, mode }`. */
  readonly listTree: (commit: Oid) => Effect.Effect<readonly GitTreeEntry[], GitError>;
  /** Read a blob by oid (content-addressed, immutable). */
  readonly readBlob: (oid: Oid) => Effect.Effect<Uint8Array, GitError>;
  /** Read a blob by path at a commit (path → oid → bytes). */
  readonly readPath: (commit: Oid, path: string) => Effect.Effect<Uint8Array, GitError>;
  /** Stage `content` at `path` in the working tree + index. */
  readonly stage: (path: string, content: Uint8Array) => Effect.Effect<void, GitError>;
  /** Remove `path` from the working tree + index. */
  readonly remove: (path: string) => Effect.Effect<void, GitError>;
  /** Commit the staged index. Returns the new commit oid. */
  readonly commit: (message: string, author: GitAuthor) => Effect.Effect<Oid, GitError>;
  /** Push the configured branch to the remote (requires a remote). */
  readonly push: Effect.Effect<void, GitError>;
  /** Commit log for the branch, newest first. */
  readonly log: (limit?: number) => Effect.Effect<readonly GitCommitInfo[], GitError>;
}

export interface GitRemote {
  /** Smart-HTTP remote, e.g. `https://<acct>.artifacts.cloudflare.net/git/<ns>/<repo>.git`. */
  readonly url: string;
  /** isomorphic-git http client (`isomorphic-git/http/web` in a Worker). */
  readonly http: git.HttpClient;
  /** Basic-auth credential. Cloudflare Artifacts uses username `x`. */
  readonly onAuth?: (() => { readonly username: string; readonly password: string }) | undefined;
  /** Extra headers (e.g. `Authorization: Bearer art_v1_…`). */
  readonly headers?: Record<string, string> | undefined;
}

export interface GitRepoBackendOptions {
  /** A Node-`fs`-compatible filesystem (use `createMemFs()` for memory). */
  readonly fs: unknown;
  /** Repo working directory inside `fs`. Defaults to `/repo`. */
  readonly dir?: string | undefined;
  /** Branch to operate on. Defaults to `main`. */
  readonly branch?: string | undefined;
  /** Remote config — omit for a purely local repo (fetch/push will fail). */
  readonly remote?: GitRemote | undefined;
}

interface MinimalFsPromises {
  mkdir(path: string): Promise<unknown>;
  writeFile(path: string, data: Uint8Array): Promise<unknown>;
  unlink(path: string): Promise<unknown>;
}

export function makeGitRepoBackend(options: GitRepoBackendOptions): GitRepoBackend {
  const fs = options.fs as git.FsClient;
  const fsp = (options.fs as { promises: MinimalFsPromises }).promises;
  const dir = options.dir ?? "/repo";
  const branch = options.branch ?? "main";
  const remote = options.remote;
  const ref = `refs/heads/${branch}`;

  const remoteParams = () => {
    if (!remote) {
      throw new Error("This repo has no remote configured (fetch/push unavailable).");
    }
    return {
      http: remote.http,
      url: remote.url,
      ...(remote.onAuth ? { onAuth: remote.onAuth } : {}),
      ...(remote.headers ? { headers: remote.headers } : {}),
    };
  };

  const run = <A>(op: string, thunk: () => Promise<A>): Effect.Effect<A, GitError> =>
    Effect.tryPromise({ try: thunk, catch: gitError(op) });

  const ensureDir = async (path: string): Promise<void> => {
    const parent = memFsDirname(path);
    if (parent === "/" || parent === path) return;
    await ensureDir(parent);
    try {
      await fsp.mkdir(parent);
    } catch (cause) {
      if ((cause as { code?: string }).code !== "EEXIST") throw cause;
    }
  };

  const head: GitRepoBackend["head"] = run("head", () =>
    git.resolveRef({ fs, dir, ref }).then(
      (oid) => oid,
      () => null,
    ),
  );

  return {
    init: run("init", () => git.init({ fs, dir, defaultBranch: branch })),

    fetch: (depth = 1) =>
      run("fetch", async () => {
        const result = await git.fetch({
          fs,
          dir,
          ref: branch,
          singleBranch: true,
          depth,
          tags: false,
          ...remoteParams(),
        });
        const oid = result.fetchHead ?? (await git.resolveRef({ fs, dir, ref }).catch(() => null));
        if (!oid) throw new Error(`Fetch returned no commit for branch '${branch}'.`);
        // Point the local branch at what we fetched so reads/commits resolve.
        await git.writeRef({ fs, dir, ref, value: oid, force: true });
        return { commit: oid };
      }),

    clone: (depth = 1) =>
      run("clone", async () => {
        await git.clone({
          fs,
          dir,
          ref: branch,
          singleBranch: true,
          depth,
          ...remoteParams(),
        });
        const oid = await git.resolveRef({ fs, dir, ref });
        return { commit: oid };
      }),

    head,

    listTree: (commit) =>
      run("listTree", async () => {
        const entries: GitTreeEntry[] = [];
        await git.walk({
          fs,
          dir,
          trees: [git.TREE({ ref: commit })],
          map: async (filepath, walkers) => {
            const entry = walkers[0];
            if (!entry || filepath === ".") return;
            const type = await entry.type();
            if (type !== "blob") return;
            const oid = await entry.oid();
            const mode = await entry.mode();
            entries.push({ path: filepath, oid, mode: mode.toString(8) });
          },
        });
        return entries;
      }),

    readBlob: (oid) =>
      run("readBlob", () => git.readBlob({ fs, dir, oid }).then((result) => result.blob)),

    readPath: (commit, path) =>
      run("readPath", () =>
        git.readBlob({ fs, dir, oid: commit, filepath: path }).then((result) => result.blob),
      ),

    stage: (path, content) =>
      run("stage", async () => {
        await ensureDir(`${dir}/${path}`);
        await fsp.writeFile(`${dir}/${path}`, content);
        await git.add({ fs, dir, filepath: path });
      }),

    remove: (path) =>
      run("remove", async () => {
        await git.remove({ fs, dir, filepath: path });
        await fsp.unlink(`${dir}/${path}`).catch(() => undefined);
      }),

    commit: (message, author) =>
      run("commit", () =>
        git.commit({
          fs,
          dir,
          ref,
          message,
          author: {
            name: author.name,
            email: author.email,
            timestamp: author.timestamp,
            timezoneOffset: author.timezoneOffset ?? 0,
          },
        }),
      ),

    push: run("push", () =>
      git
        .push({ fs, dir, ref: branch, remoteRef: branch, ...remoteParams() })
        .then(() => undefined),
    ),

    log: (limit) =>
      run("log", async () => {
        const commits = await git.log({ fs, dir, ref, ...(limit ? { depth: limit } : {}) });
        return commits.map((entry) => ({
          oid: entry.oid,
          message: entry.commit.message,
          parents: entry.commit.parent,
          author: {
            name: entry.commit.author.name,
            email: entry.commit.author.email,
            timestamp: entry.commit.author.timestamp,
          },
        }));
      }),
  };
}
