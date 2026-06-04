import { Effect } from "effect";
import { artifactsError, type ArtifactsError } from "./errors";

export interface RepoHandle {
  readonly name: string;
  /** Smart-HTTP git remote, or `null` for a purely-local repo (memory provider). */
  readonly remote: string | null;
  readonly defaultBranch: string;
}

export interface GitCredential {
  readonly username: string;
  readonly password: string;
  readonly expiresAt: number;
}

export interface EnsureRepoOptions {
  readonly description?: string | undefined;
  readonly defaultBranch?: string | undefined;
  readonly readOnly?: boolean | undefined;
}

/**
 * Layer 1 — a thin Effect port over Cloudflare Artifacts repo *management*, so
 * the rest of the stack never imports `cloudflare:workers`. Implementations:
 * {@link cloudflareArtifactsProvider} (prod) and {@link memoryRepoProvider} (tests/local).
 */
export interface ArtifactsRepoProvider {
  /** Get-or-create a repo by name. */
  readonly ensure: (
    name: string,
    options?: EnsureRepoOptions,
  ) => Effect.Effect<RepoHandle, ArtifactsError>;
  /** Mint a short-lived git credential for `name`. `null` when the repo is local-only. */
  readonly token: (
    name: string,
    scope: "read" | "write",
    ttlSeconds?: number,
  ) => Effect.Effect<GitCredential | null, ArtifactsError>;
  /** Delete a repo. Returns whether it existed. */
  readonly delete: (name: string) => Effect.Effect<boolean, ArtifactsError>;
}

/* ------------------------------------------------------------------ *
 * Cloudflare Artifacts Workers binding (`env.ARTIFACTS`)
 * ------------------------------------------------------------------ */

/** Minimal shape of the (beta) Cloudflare Artifacts Workers binding we depend on. */
export interface CloudflareArtifactsBinding {
  create(
    name: string,
    options?: {
      readOnly?: boolean;
      description?: string;
      setDefaultBranch?: string;
    },
  ): Promise<CloudflareArtifactsRepo>;
  get(name: string): Promise<CloudflareArtifactsRepo | null>;
  delete(name: string): Promise<boolean>;
}

export interface CloudflareArtifactsRepo {
  readonly name: string;
  readonly remote: string;
  readonly defaultBranch: string;
  createToken(
    scope: "read" | "write",
    ttlSeconds: number,
  ): Promise<{ plaintext: string; scope: string; expiresAt: number }>;
}

export function cloudflareArtifactsProvider(
  binding: CloudflareArtifactsBinding,
): ArtifactsRepoProvider {
  const getOrCreate = (name: string, options?: EnsureRepoOptions) =>
    Effect.tryPromise({
      try: async () => {
        const existing = await getExistingRepo(binding, name);
        if (existing) return existing;
        return binding.create(name, {
          ...(options?.readOnly === undefined ? {} : { readOnly: options.readOnly }),
          ...(options?.description ? { description: options.description } : {}),
          ...(options?.defaultBranch ? { setDefaultBranch: options.defaultBranch } : {}),
        });
      },
      catch: artifactsError("ensure"),
    });

  return {
    ensure: (name, options) =>
      getOrCreate(name, options).pipe(
        Effect.map((repo) => ({
          name: repo.name,
          remote: repo.remote,
          defaultBranch: repo.defaultBranch,
        })),
      ),

    token: (name, scope, ttlSeconds = 3600) =>
      Effect.tryPromise({
        try: async () => {
          const repo = await binding.get(name);
          if (!repo) throw new Error(`Artifacts repo not found: ${name}`);
          const token = await repo.createToken(scope, ttlSeconds);
          // Token form is `art_v1_<hex>?expires=<unix>`; git Basic auth uses the
          // secret before `?expires=` as the password with username `x`.
          const password = token.plaintext.split("?")[0] ?? token.plaintext;
          return { username: "x", password, expiresAt: token.expiresAt } satisfies GitCredential;
        },
        catch: artifactsError("token"),
      }),

    delete: (name) =>
      Effect.tryPromise({ try: () => binding.delete(name), catch: artifactsError("delete") }),
  };
}

async function getExistingRepo(
  binding: CloudflareArtifactsBinding,
  name: string,
): Promise<CloudflareArtifactsRepo | null> {
  try {
    return await binding.get(name);
  } catch (cause) {
    if (isArtifactsRepoNotFound(cause)) return null;
    throw cause;
  }
}

function isArtifactsRepoNotFound(cause: unknown): boolean {
  const message = cause instanceof Error ? cause.message : String(cause);
  return /repository not found/i.test(message);
}

/* ------------------------------------------------------------------ *
 * In-memory / local provider (no remote) — for tests and local git.
 * ------------------------------------------------------------------ */

export interface MemoryRepoProviderOptions {
  readonly defaultBranch?: string | undefined;
}

export function memoryRepoProvider(options: MemoryRepoProviderOptions = {}): ArtifactsRepoProvider {
  const defaultBranch = options.defaultBranch ?? "main";
  const repos = new Set<string>();
  return {
    ensure: (name) =>
      Effect.sync(() => {
        repos.add(name);
        return { name, remote: null, defaultBranch };
      }),
    token: () => Effect.succeed(null),
    delete: (name) => Effect.sync(() => repos.delete(name)),
  };
}
