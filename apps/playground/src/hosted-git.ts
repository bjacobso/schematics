import type { SourceFile } from "@schematics/core";
import {
  createMemFs,
  makeGitArtifactStore,
  makeBrowserGitRepoBackend,
  type GitAuthor,
  type GitArtifactActor,
  type GitArtifactStore,
  type GitRepoBackend,
} from "@schematics/git-artifacts";
import { SchematicsArtifactProjectError, SchematicsDeployError } from "@schematics/protocol";
import type {
  ArtifactChangeRequest,
  ArtifactProjectChangeProvenance,
  ArtifactProjectChangeRequest,
  ArtifactProjectHistoryEntry,
  GetArtifactProjectHistoryResponse,
  SchematicsDeployService,
  SchematicsArtifactProjectService,
} from "@schematics/protocol";
import { Effect } from "effect";

export interface HostedGitInfo {
  readonly remote: string;
  readonly defaultBranch: string;
}

export interface HostedGitCommitter {
  readonly store: GitArtifactStore;
  readonly commitSnapshot: (
    files: readonly SourceFile[],
    options: HostedGitCommitOptions,
  ) => Effect.Effect<string | null>;
  readonly getHistory: Effect.Effect<
    GetArtifactProjectHistoryResponse,
    SchematicsArtifactProjectError
  >;
  readonly commitStore: (options: HostedGitCommitOptions) => Effect.Effect<string | null>;
  readonly refreshStore: Effect.Effect<void>;
  readonly snapshotStore: Effect.Effect<readonly SourceFile[]>;
}

export interface HostedGitCommitOptions {
  readonly subject: string;
  readonly provenance?: ArtifactProjectChangeProvenance | undefined;
}

interface HostedGitCommitterState {
  initialized: boolean;
  lastSignature: string | null;
  knownPaths: Set<string>;
}

export function createHostedGitCommitter(git: HostedGitInfo): HostedGitCommitter {
  const fs = createMemFs();
  const backend = makeBrowserGitRepoBackend({
    fs,
    branch: git.defaultBranch,
    remote: { url: git.remote },
  });
  const store = makeGitArtifactStore({ backend });
  const state: HostedGitCommitterState = {
    initialized: false,
    lastSignature: null,
    knownPaths: new Set(),
  };

  const refreshStore = Effect.tryPromise({
    try: async () => {
      await ensureInitialized(backend, state);
      await Effect.runPromise(backend.fetch(50).pipe(Effect.catch(() => Effect.void)));
      await Effect.runPromise(store.seed);
    },
    catch: (cause) => cause,
  });

  return {
    store,
    getHistory: Effect.tryPromise({
      try: async () => {
        await Effect.runPromise(refreshStore);
        const commits = await Effect.runPromise(backend.log(50));
        const entries = await Promise.all(
          commits.map(async (commit) =>
            gitCommitToHistoryEntry({
              ...commit,
              changes: await historyChangesForCommit(
                backend,
                commit.oid,
                commit.parents[0] ?? null,
              ),
            }),
          ),
        );
        return { source: "git", entries };
      },
      catch: (cause) =>
        new SchematicsArtifactProjectError(
          `Hosted workspace history is not available: ${errorMessage(cause)}`,
          "unsupported",
        ),
    }),
    commitSnapshot: (files, options) =>
      Effect.tryPromise({
        try: async () => {
          await ensureInitialized(backend, state);
          const signature = signatureForFiles(files);
          if (state.lastSignature === signature) return null;

          const nextPaths = new Set(files.map((file) => file.path));
          for (const path of state.knownPaths) {
            if (!nextPaths.has(path)) await Effect.runPromise(backend.remove(path));
          }
          for (const file of files) {
            await Effect.runPromise(
              backend.stage(file.path, new TextEncoder().encode(file.content)),
            );
          }

          const oid = await Effect.runPromise(
            backend.commit(commitMessage(options), authorForProvenance(options.provenance)),
          );
          await Effect.runPromise(backend.push);
          state.knownPaths = nextPaths;
          state.lastSignature = signature;
          return oid;
        },
        catch: (cause) => cause,
      }),
    commitStore: (options) =>
      Effect.gen(function* () {
        const dirty = yield* store.hasUncommittedChanges;
        if (!dirty) return null;
        return yield* store.commit({
          message: options.subject,
          actor: actorForProvenance(options.provenance),
          author: authorForProvenance(options.provenance),
          turnId: options.provenance?.turnId,
          toolCallId: options.provenance?.toolCallId,
          push: true,
        });
      }),
    refreshStore,
    snapshotStore: Effect.gen(function* () {
      const refs = yield* store.list;
      const files: SourceFile[] = [];
      for (const ref of refs) {
        if (ref._tag !== "ProjectFile" && ref._tag !== "Path") continue;
        const content = yield* store.read(ref);
        files.push({
          path: ref.path,
          content: typeof content === "string" ? content : new TextDecoder().decode(content),
        });
      }
      const sorted = files.sort((left, right) => left.path.localeCompare(right.path));
      state.knownPaths = new Set(sorted.map((file) => file.path));
      state.lastSignature = signatureForFiles(sorted);
      return sorted;
    }),
  };
}

export function withHostedGitCommits(
  workspace: SchematicsArtifactProjectService,
  committer: HostedGitCommitter,
): SchematicsArtifactProjectService {
  const commitCurrentSnapshot = (options: HostedGitCommitOptions) =>
    workspace.getSnapshot.pipe(
      Effect.flatMap((snapshot) => committer.commitSnapshot(snapshot.files, options)),
      Effect.catch((error) =>
        Effect.sync(() => {
          console.warn("Hosted git commit failed:", error);
          return null;
        }),
      ),
    );

  return {
    ...workspace,
    applyChange: (change) =>
      workspace.applyChange(change).pipe(
        Effect.tap(() =>
          commitCurrentSnapshot({
            subject: subjectForProjectChange(change),
            provenance: change.provenance,
          }),
        ),
      ),
    applyArtifactChange: (change) =>
      workspace.applyArtifactChange(change).pipe(
        Effect.tap(() =>
          commitCurrentSnapshot({
            subject: subjectForArtifactChange(change),
            provenance: change.provenance,
          }),
        ),
      ),
    getHistory: committer.getHistory,
  };
}

export function withHostedGitDeployCommits(
  deploy: SchematicsDeployService,
  workspace: SchematicsArtifactProjectService,
  committer: HostedGitCommitter,
): SchematicsDeployService {
  const commitAndMirror = (options: HostedGitCommitOptions) =>
    Effect.gen(function* () {
      yield* committer.commitStore(options).pipe(Effect.mapError(toDeployStorageError));
      const files = yield* committer.snapshotStore.pipe(Effect.mapError(toDeployStorageError));
      yield* workspace
        .applyChange({
          type: "replaceFiles",
          files,
          provenance: options.provenance,
        })
        .pipe(Effect.mapError(toDeployStorageError));
    });

  const refresh = committer.refreshStore.pipe(Effect.mapError(toDeployStorageError));

  return {
    ...deploy,
    connect: (request) => refresh.pipe(Effect.flatMap(() => deploy.connect(request))),
    pull: refresh.pipe(
      Effect.flatMap(() => deploy.pull),
      Effect.tap(() =>
        commitAndMirror({
          subject: "Pull Onboarded account",
          provenance: { actor: "system" },
        }),
      ),
    ),
    plan: refresh.pipe(Effect.flatMap(() => deploy.plan)),
    apply: (request) =>
      refresh.pipe(
        Effect.flatMap(() => deploy.apply(request)),
        Effect.tap(() =>
          commitAndMirror({
            subject: "Apply Onboarded account",
            provenance: { actor: "system" },
          }),
        ),
      ),
    destroy: refresh.pipe(
      Effect.flatMap(() => deploy.destroy),
      Effect.tap(() =>
        commitAndMirror({
          subject: "Destroy Onboarded account",
          provenance: { actor: "system" },
        }),
      ),
    ),
  };
}

async function ensureInitialized(
  backend: GitRepoBackend,
  state: HostedGitCommitterState,
): Promise<void> {
  if (state.initialized) return;
  const cloned = await Effect.runPromise(
    backend.clone(50).pipe(
      Effect.map(() => true),
      Effect.catch(() => Effect.succeed(false)),
    ),
  );
  if (!cloned) {
    await Effect.runPromise(backend.init);
  }

  const head = await Effect.runPromise(backend.head);
  if (head) {
    const entries = await Effect.runPromise(backend.listTree(head));
    const files = await Promise.all(
      entries.map(async (entry) => ({
        path: entry.path,
        content: new TextDecoder().decode(
          await Effect.runPromise(backend.readPath(head, entry.path)),
        ),
      })),
    );
    state.knownPaths = new Set(files.map((file) => file.path));
    state.lastSignature = signatureForFiles(files);
  }
  state.initialized = true;
}

type HistoryFileChange = ArtifactProjectHistoryEntry["changes"][number];

async function historyChangesForCommit(
  backend: GitRepoBackend,
  commit: string,
  parent: string | null,
): Promise<readonly HistoryFileChange[]> {
  const afterTree = await treeByPath(backend, commit);
  const beforeTree = parent ? await treeByPath(backend, parent) : new Map<string, string>();
  const paths = new Set([...beforeTree.keys(), ...afterTree.keys()]);
  const changes: HistoryFileChange[] = [];

  for (const path of [...paths].sort()) {
    const beforeOid = beforeTree.get(path);
    const afterOid = afterTree.get(path);
    if (beforeOid === afterOid) continue;
    const beforeContent = beforeOid ? await readTextPath(backend, parent!, path) : null;
    const afterContent = afterOid ? await readTextPath(backend, commit, path) : null;
    changes.push({
      path,
      status: beforeOid ? (afterOid ? "modified" : "deleted") : "added",
      beforeContent,
      afterContent,
    });
  }

  return changes;
}

async function treeByPath(backend: GitRepoBackend, commit: string): Promise<Map<string, string>> {
  const entries = await Effect.runPromise(backend.listTree(commit));
  return new Map(entries.map((entry) => [entry.path, entry.oid]));
}

async function readTextPath(
  backend: GitRepoBackend,
  commit: string,
  path: string,
): Promise<string> {
  return new TextDecoder().decode(await Effect.runPromise(backend.readPath(commit, path)));
}

function gitCommitToHistoryEntry(commit: {
  readonly oid: string;
  readonly message: string;
  readonly author: { readonly name: string; readonly email: string; readonly timestamp: number };
  readonly changes: readonly HistoryFileChange[];
}): ArtifactProjectHistoryEntry {
  const subject = commit.message.split(/\r?\n/, 1)[0]?.trim() || commit.oid.slice(0, 7);
  return {
    kind: "git-commit",
    oid: commit.oid,
    subject,
    message: commit.message,
    author: commit.author,
    trailers: parseGitTrailers(commit.message),
    changes: commit.changes,
  };
}

function parseGitTrailers(message: string): ArtifactProjectHistoryEntry["trailers"] {
  const trailers: { actor?: string; turnId?: string; toolCallId?: string } = {};
  for (const line of message.split(/\r?\n/).reverse()) {
    const match = /^([A-Za-z][A-Za-z0-9-]*):\s*(.*)$/.exec(line.trim());
    if (!match) {
      if (line.trim() === "") continue;
      break;
    }
    const key = match[1] ?? "";
    const value = match[2] ?? "";
    if (key === "Actor") trailers.actor = value;
    else if (key === "Turn-Id") trailers.turnId = value;
    else if (key === "Tool-Call-Id") trailers.toolCallId = value;
  }
  return trailers;
}

function errorMessage(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === "string") return cause;
  return "unknown error";
}

function signatureForFiles(files: readonly SourceFile[]): string {
  return JSON.stringify(
    [...files]
      .map((file) => [file.path, file.content] as const)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function commitMessage(options: HostedGitCommitOptions): string {
  const provenance = options.provenance;
  return [
    options.subject,
    "",
    `Actor: ${provenance?.actor ?? "user"}`,
    ...(provenance?.turnId ? [`Turn-Id: ${provenance.turnId}`] : []),
    ...(provenance?.toolCallId ? [`Tool-Call-Id: ${provenance.toolCallId}`] : []),
  ].join("\n");
}

function authorForProvenance(provenance: ArtifactProjectChangeProvenance | undefined): GitAuthor {
  const actor = provenance?.actor ?? "user";
  const name =
    actor === "agent" ? "Schematics Agent" : actor === "system" ? "Schematics" : "Schematics User";
  const email =
    actor === "agent"
      ? "agent@schematics.local"
      : actor === "system"
        ? "schematics@localhost"
        : "user@schematics.local";
  return { name, email, timestamp: Math.floor(Date.now() / 1000), timezoneOffset: 0 };
}

function actorForProvenance(
  provenance: ArtifactProjectChangeProvenance | undefined,
): GitArtifactActor {
  const actor = provenance?.actor;
  return actor === "agent" || actor === "system" ? actor : "user";
}

function toDeployStorageError(cause: unknown): SchematicsDeployError {
  if (cause instanceof SchematicsDeployError) return cause;
  return new SchematicsDeployError(errorMessage(cause), "storage");
}

function subjectForProjectChange(change: ArtifactProjectChangeRequest): string {
  switch (change.type) {
    case "writeFile":
      return `Write ${change.path}`;
    case "createFile":
      return `Create ${change.path}`;
    case "deleteFile":
      return `Delete ${change.path}`;
    case "renameFile":
      return `Rename ${change.fromPath} to ${change.toPath}`;
    case "replaceFiles":
      return "Replace workspace files";
  }
}

function subjectForArtifactChange(change: ArtifactChangeRequest): string {
  return `Write ${change.ref.path}`;
}
