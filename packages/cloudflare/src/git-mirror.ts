import type { SourceFile } from "@schema-ide/core";
import {
  ArtifactsError,
  GitError,
  cloudflareArtifactsProvider,
  createMemFs,
  makeGitArtifactStoreFromProvider,
  type ArtifactsRepoProvider,
  type CloudflareArtifactsBinding,
  type GitArtifactActor,
  type Oid,
} from "@schema-ide/git-artifacts";
import { ArtifactRef } from "@schema-ide/artifacts";
import { Effect } from "effect";

const BINARY_PATH = /\.(?:pdf|png|jpe?g|gif|webp|wasm|zip|woff2?)$/i;

const isBinaryPath = (path: string): boolean => BINARY_PATH.test(path);

/** SourceFile content stores binary as base64 — decode it back to bytes for git. */
function decodeBinary(content: string): Uint8Array {
  const trimmed = content.trim();
  const match = trimmed.match(/^data:[^,]*;base64,([\s\S]*)$/i);
  const base64 = (match?.[1] ?? trimmed).replace(/\s+/g, "");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export interface MirrorWorkspaceOptions {
  readonly provider: ArtifactsRepoProvider;
  /** Repo name in the namespace — typically the workspace id. */
  readonly repo: string;
  /** The full desired file set (the workspace snapshot). */
  readonly files: readonly SourceFile[];
  readonly message: string;
  readonly actor?: GitArtifactActor | undefined;
  /** Unix seconds for the commit (pass from the request, not a wall clock). */
  readonly timestamp?: number | undefined;
  readonly projectId?: string | undefined;
}

/**
 * Replace a Git repo's working tree with `files` and commit (+push) — the
 * "Git via Cloudflare Artifacts" mirror. Each workspace revision becomes a real
 * commit on a cloneable remote. Returns the commit oid, or `null` if nothing
 * changed.
 */
export const mirrorWorkspaceToGit = (
  options: MirrorWorkspaceOptions,
): Effect.Effect<Oid | null, ArtifactsError | GitError> =>
  Effect.gen(function* () {
    const store = yield* makeGitArtifactStoreFromProvider({
      provider: options.provider,
      repo: options.repo,
      fs: createMemFs(),
      isBinaryPath,
      ...(options.projectId ? { projectId: options.projectId } : {}),
    });

    const desired = new Map(options.files.map((file) => [file.path, file]));
    const existing = yield* store.list.pipe(Effect.orDie);
    const existingPaths = new Set(
      existing.flatMap((ref) => (ref._tag === "ProjectFile" ? [ref.path] : [])),
    );

    let changed = false;

    // Delete files no longer present.
    for (const path of existingPaths) {
      if (!desired.has(path)) {
        yield* store.delete(ArtifactRef.projectFile(path, options.projectId)).pipe(Effect.orDie);
        changed = true;
      }
    }

    // Create or update the rest.
    for (const file of options.files) {
      const content = isBinaryPath(file.path) ? decodeBinary(file.content) : file.content;
      const ref = ArtifactRef.projectFile(file.path, options.projectId);
      if (existingPaths.has(file.path)) {
        yield* store.write(ref, content).pipe(Effect.orDie);
      } else {
        yield* store.create(ref, content).pipe(Effect.orDie);
      }
      changed = true;
    }

    if (!changed) return null;

    return yield* store.commit({
      message: options.message,
      ...(options.actor ? { actor: options.actor } : {}),
      ...(options.timestamp !== undefined ? { timestamp: options.timestamp } : {}),
    });
  });

/** Build an {@link ArtifactsRepoProvider} from the worker's Artifacts binding. */
export const providerFromBinding = (binding: CloudflareArtifactsBinding): ArtifactsRepoProvider =>
  cloudflareArtifactsProvider(binding);
