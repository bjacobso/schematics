import { readdir, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import {
  ArtifactRef,
  pathFromArtifactRef,
  loadedEntry,
  type ArtifactContent,
  type ArtifactRef as ArtifactRefValue,
  type ArtifactStore,
  type ArtifactStoreEntry,
  type ArtifactStoreError,
} from "@schematics/artifacts";
import { Effect } from "effect";

/**
 * A filesystem-backed {@link ArtifactStore} over a base directory, addressing
 * files by `ProjectFile` ref path (POSIX-relative). Used by the deploy CLI so
 * `pull`/`apply` and the lockfile persist to disk across invocations.
 */
export function createFsArtifactStore(
  baseDir: string,
  options: { readonly projectId?: string | undefined } = {},
): ArtifactStore {
  const projectId = options.projectId;
  const toAbs = (ref: ArtifactRefValue): string | null => {
    const path = pathFromArtifactRef(ref);
    return path === null ? null : join(baseDir, path);
  };
  const storeError = (
    reason: ArtifactStoreError["reason"],
    ref: ArtifactRefValue,
  ): ArtifactStoreError => ({ _tag: "ArtifactStoreError", reason, ref });

  const listRefs = Effect.tryPromise({
    try: async () => {
      const out: ArtifactRefValue[] = [];
      const walk = async (dir: string): Promise<void> => {
        const dirEntries = await readdir(dir, { withFileTypes: true }).catch(() => []);
        for (const entry of dirEntries) {
          const abs = join(dir, entry.name);
          if (entry.isDirectory()) await walk(abs);
          else
            out.push(
              ArtifactRef.projectFile(relative(baseDir, abs).split(sep).join("/"), projectId),
            );
        }
      };
      await walk(baseDir);
      return out as readonly ArtifactRefValue[];
    },
    catch: () => [] as readonly ArtifactRefValue[],
  }).pipe(Effect.orElseSucceed(() => [] as readonly ArtifactRefValue[]));

  const read = (ref: ArtifactRefValue): Effect.Effect<ArtifactContent, ArtifactStoreError> => {
    const abs = toAbs(ref);
    if (abs === null) return Effect.fail(storeError("unsupported-ref", ref));
    return Effect.tryPromise({
      try: () => readFile(abs, "utf8") as Promise<ArtifactContent>,
      catch: () => storeError("not-found", ref),
    });
  };

  const writeFileAt = (abs: string, content: ArtifactContent) =>
    Effect.promise(async () => {
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, typeof content === "string" ? content : Buffer.from(content));
    });

  return {
    list: listRefs.pipe(Effect.orDie),

    entries: Effect.gen(function* () {
      const refs = yield* listRefs.pipe(Effect.orDie);
      const result: ArtifactStoreEntry[] = [];
      for (const ref of refs) {
        const content = yield* read(ref).pipe(Effect.orElseSucceed(() => null));
        if (content !== null) result.push(loadedEntry(ref, content));
      }
      return result;
    }),

    read,

    write: (ref, content) =>
      Effect.gen(function* () {
        const abs = toAbs(ref);
        if (abs === null) return yield* Effect.fail(storeError("unsupported-ref", ref));
        const exists = yield* Effect.promise(() =>
          stat(abs)
            .then(() => true)
            .catch(() => false),
        );
        if (!exists) return yield* Effect.fail(storeError("not-found", ref));
        yield* writeFileAt(abs, content);
      }),

    create: (ref, content) =>
      Effect.gen(function* () {
        const abs = toAbs(ref);
        if (abs === null) return yield* Effect.fail(storeError("unsupported-ref", ref));
        const exists = yield* Effect.promise(() =>
          stat(abs)
            .then(() => true)
            .catch(() => false),
        );
        if (exists) return yield* Effect.fail(storeError("already-exists", ref));
        yield* writeFileAt(abs, content);
        return ref;
      }),

    delete: (ref) =>
      Effect.gen(function* () {
        const abs = toAbs(ref);
        if (abs === null) return yield* Effect.fail(storeError("unsupported-ref", ref));
        const exists = yield* Effect.promise(() =>
          stat(abs)
            .then(() => true)
            .catch(() => false),
        );
        if (!exists) return yield* Effect.fail(storeError("not-found", ref));
        yield* Effect.promise(() => rm(abs));
      }),
  };
}
