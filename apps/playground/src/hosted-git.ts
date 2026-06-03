import type { SourceFile } from "@schematics/core";
import {
  createMemFs,
  makeBrowserGitRepoBackend,
  type GitAuthor,
  type GitRepoBackend,
} from "@schematics/git-artifacts";
import type {
  ArtifactChangeRequest,
  ArtifactProjectChangeProvenance,
  ArtifactProjectChangeRequest,
  SchematicsArtifactProjectService,
} from "@schematics/protocol";
import { Effect } from "effect";

export interface HostedGitInfo {
  readonly remote: string;
  readonly defaultBranch: string;
}

export interface HostedGitCommitter {
  readonly commitSnapshot: (
    files: readonly SourceFile[],
    options: HostedGitCommitOptions,
  ) => Effect.Effect<string | null>;
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
  const state: HostedGitCommitterState = {
    initialized: false,
    lastSignature: null,
    knownPaths: new Set(),
  };

  return {
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
  };
}

async function ensureInitialized(
  backend: GitRepoBackend,
  state: HostedGitCommitterState,
): Promise<void> {
  if (state.initialized) return;
  const cloned = await Effect.runPromise(
    backend.clone().pipe(
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
