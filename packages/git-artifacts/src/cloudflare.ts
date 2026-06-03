import http from "isomorphic-git/http/web";
import { Effect } from "effect";
import type { ArtifactsError } from "./errors";
import {
  makeGitArtifactStore,
  type GitArtifactStore,
  type GitArtifactStoreOptions,
} from "./git-artifact-store";
import { makeGitRepoBackend } from "./git-repo-backend";
import type { ArtifactsRepoProvider } from "./repo-provider";

export interface GitArtifactStoreFromProviderOptions extends Omit<
  GitArtifactStoreOptions,
  "backend" | "hasRemote"
> {
  readonly provider: ArtifactsRepoProvider;
  /** Repo name in the Artifacts namespace (e.g. the workspace id). */
  readonly repo: string;
  /** A fresh in-memory FS (`createMemFs()`), or any node-fs-compatible fs. */
  readonly fs: unknown;
  readonly dir?: string | undefined;
  readonly scope?: "read" | "write" | undefined;
  /** Seed the store immediately (fetch+listTree for remote, init for local). Default true. */
  readonly seed?: boolean | undefined;
}

/**
 * Compose provider (Layer 1) + isomorphic-git backend (Layer 2) + store (Layer 3).
 *
 * - **Remote handle** (Cloudflare Artifacts): mint a token, point the web http
 *   client at the smart-HTTP remote, fetch the branch on seed, push on commit.
 * - **Local handle** (`memoryRepoProvider`, `remote: null`): no network — the repo
 *   lives entirely in the provided `fs`; the store is `init`-ed on seed. This is
 *   what makes the whole stack testable without a Cloudflare account.
 */
export const makeGitArtifactStoreFromProvider = (
  options: GitArtifactStoreFromProviderOptions,
): Effect.Effect<GitArtifactStore, ArtifactsError> =>
  Effect.gen(function* () {
    const handle = yield* options.provider.ensure(options.repo);
    const hasRemote = handle.remote !== null;
    const credential = hasRemote
      ? yield* options.provider.token(options.repo, options.scope ?? "write")
      : null;

    const backend = makeGitRepoBackend({
      fs: options.fs,
      ...(options.dir ? { dir: options.dir } : {}),
      branch: handle.defaultBranch,
      ...(handle.remote
        ? {
            remote: {
              url: handle.remote,
              http,
              ...(credential
                ? {
                    onAuth: () => ({
                      username: credential.username,
                      password: credential.password,
                    }),
                  }
                : {}),
            },
          }
        : {}),
    });

    const store = makeGitArtifactStore({
      backend,
      hasRemote,
      ...(options.projectId ? { projectId: options.projectId } : {}),
      ...(options.isBinaryPath ? { isBinaryPath: options.isBinaryPath } : {}),
      ...(options.defaultAuthor ? { defaultAuthor: options.defaultAuthor } : {}),
    });

    if (options.seed ?? true) {
      // Local repos need an empty repo to exist before seed lists its (empty) tree.
      if (!hasRemote) yield* backend.init.pipe(Effect.ignore);
      yield* store.seed.pipe(Effect.orDie);
    }

    return store;
  });
