# Workspace Branches and Review/Merge Plan

## Goal

Add a provider-neutral concept similar to a Git worktree: create an isolated
copy of a workspace, make edits there, review the delta, and merge those edits
back into the main workspace branch.

This should work across all workspace backends:

- In-memory playground workspaces.
- Cloudflare hosted workspaces backed by Durable Objects.
- Local filesystem workspaces, ideally with real Git worktrees when available
  and a directory-copy fallback when Git is not available.

The feature should not require the editor to fork into separate code paths. The
existing `SchemaIdeWorkspaceService` remains the editing surface for one active
workspace branch. New branch/review APIs manage branch creation, comparison, and
merge.

## Current Starting Point

The repo already has the right primitives:

- `SchemaIdeWorkspaceService` in `@schema-ide/protocol` is the common UI-facing
  interface for capabilities, snapshots, changes, watching, and previews.
- `createMemoryWorkspaceClient` in `@schema-ide/react` owns an in-memory
  `VersionedWorkspaceState`.
- `createLocalFilesystemWorkspaceClient` in `@schema-ide/cli` maps workspace
  changes to files under a local directory.
- `SchemaIdeWorkspaceObject` in `@schema-ide/cloudflare` persists hosted
  workspace files and revisions in a Durable Object.
- `@schema-ide/core/workspace-history` already models a linear revision history
  with patches, parent revision IDs, undo, redo, and checkout.

The missing piece is a first-class branch/ref model above those single-branch
workspace services.

## Terms

- Workspace: the logical project opened by Schema IDE.
- Branch: an isolated editable ref inside a workspace.
- Main branch: the canonical branch users eventually merge into.
- Draft branch: a temporary branch created for user or agent edits.
- Base revision: the main branch revision used when the draft branch was
  created.
- Head revision: the latest revision on a branch.
- Review: a diff between a draft branch and its base or target branch.
- Merge: applying the draft branch changes into the target branch.

This feature should call the concept "workspace branches" in the product/API.
"Worktree" can appear in docs as an analogy, but we should avoid implying that
every backend is using Git.

## Product Flow

1. User opens a workspace on the main branch.
2. User or agent chooses "Create branch".
3. The system creates a draft branch from the current main branch snapshot.
4. The editor switches to the draft branch and all normal file operations apply
   only there.
5. User reviews the draft branch:
   - changed files
   - added/deleted/renamed files
   - validation summary for the draft
   - optional per-file diff
6. User merges the draft branch into main.
7. If main has not moved since the draft's base revision, merge is a
   fast-forward or patch replay.
8. If main moved, the backend performs a three-way merge by file path/content.
9. If conflicts exist, the backend returns a structured conflict response and
   leaves both branches unchanged.
10. After a successful merge, main receives a merge revision and the draft
    branch can be retained, archived, or deleted.

## Data Model

Add branch-aware domain types in `@schema-ide/core`, probably in a new
`workspace-branches.ts` module.

```ts
export type WorkspaceBranchKind = "main" | "draft" | "archived";

export interface WorkspaceBranchMetadata {
  readonly id: string;
  readonly name: string;
  readonly kind: WorkspaceBranchKind;
  readonly baseBranchId: string | null;
  readonly baseRevisionId: string | null;
  readonly headRevisionId: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly createdBy?: "user" | "agent" | "system" | undefined;
  readonly title?: string | undefined;
}

export interface WorkspaceBranchState {
  readonly metadata: WorkspaceBranchMetadata;
  readonly workspace: VersionedWorkspaceState;
}
```

The main branch should be represented explicitly. Existing single-branch
workspaces can be adapted by creating a synthetic main branch:

```text
branch id: main
kind: main
baseBranchId: null
baseRevisionId: null
headRevisionId: current revision or null
```

### Revision IDs

The current `createVersionedWorkspace` generates local IDs like `rev-1`. For
multi-branch backends, branch IDs and revision IDs need to remain stable across
branch copies and persistence boundaries.

MVP options:

- Keep `rev-N` inside a branch and identify revisions as
  `{ branchId, revisionId }`.
- Or introduce globally unique revision IDs such as `rev_${uuid}`.

Recommended MVP: use compound revision references in the branch APIs and avoid
rewriting the existing linear history internals immediately. A later phase can
move revision ID generation behind an injectable generator.

## Core Operations

Add pure functions in `@schema-ide/core` for branch behavior:

```ts
createWorkspaceBranch(input): WorkspaceBranchState
compareWorkspaceBranches(input): WorkspaceBranchComparison
mergeWorkspaceBranch(input): WorkspaceBranchMergeResult
detectWorkspaceBranchConflicts(input): readonly WorkspaceMergeConflict[]
```

The pure merge function should accept three file snapshots:

- base files
- target files
- source files

It should return either merged files or conflicts.

### Merge Semantics

Use path-level three-way merge for the MVP:

- If source did not change a path from base, keep target.
- If target did not change a path from base, take source.
- If both changed a path to the same content, keep that content.
- If source deletes a path and target leaves it unchanged, delete it.
- If target deletes a path and source leaves it unchanged, keep deletion.
- If both delete a path, keep deletion.
- If one side renames and the other edits/deletes the old path, report a
  conflict unless a clear rename map exists.
- If both change the same path to different content, report a conflict.

Do not attempt line-level conflict markers in the MVP. The editor can later add
an assisted conflict resolver that picks source, target, or a custom merged
file.

### Comparison Shape

```ts
export interface WorkspaceBranchComparison {
  readonly baseRevisionId: string | null;
  readonly sourceBranchId: string;
  readonly targetBranchId: string;
  readonly files: readonly WorkspaceFileDiff[];
  readonly validationSummary: SchemaIdeValidationSummary;
  readonly mergeable: boolean;
  readonly conflicts: readonly WorkspaceMergeConflict[];
}

export type WorkspaceFileDiff =
  | { readonly type: "added"; readonly path: string; readonly after: SourceFile }
  | { readonly type: "deleted"; readonly path: string; readonly before: SourceFile }
  | {
      readonly type: "modified";
      readonly path: string;
      readonly before: SourceFile;
      readonly after: SourceFile;
    }
  | {
      readonly type: "renamed";
      readonly fromPath: string;
      readonly toPath: string;
      readonly before: SourceFile;
      readonly after: SourceFile;
    };
```

Rename detection can be content-equality based in the MVP and improved later.

## Protocol Additions

Keep `SchemaIdeWorkspaceService` focused on editing the active branch. Add a
separate branch RPC group in `@schema-ide/protocol`:

```ts
export class SchemaIdeWorkspaceBranchRpcGroup extends RpcGroup.make(
  Rpc.make("ListBranches", ...),
  Rpc.make("CreateBranch", ...),
  Rpc.make("GetBranch", ...),
  Rpc.make("CompareBranch", ...),
  Rpc.make("MergeBranch", ...),
  Rpc.make("DeleteBranch", ...),
  Rpc.make("ArchiveBranch", ...)
) {}
```

Suggested payloads:

```ts
interface CreateBranchRequest {
  readonly fromBranchId?: string | undefined; // default: main
  readonly fromRevisionId?: string | null | undefined; // default: source head
  readonly name?: string | undefined;
  readonly title?: string | undefined;
  readonly createdBy?: "user" | "agent" | "system" | undefined;
}

interface CreateBranchResponse {
  readonly branch: WorkspaceBranchMetadata;
  readonly url?: string | undefined;
}

interface CompareBranchRequest {
  readonly sourceBranchId: string;
  readonly targetBranchId?: string | undefined; // default: main
}

interface MergeBranchRequest {
  readonly sourceBranchId: string;
  readonly targetBranchId?: string | undefined; // default: main
  readonly strategy?: "three-way" | "source-wins" | "target-wins" | undefined;
  readonly deleteSource?: boolean | undefined;
  readonly expectedTargetRevisionId?: string | null | undefined;
}

type MergeBranchResponse =
  | { readonly status: "merged"; readonly targetBranch: WorkspaceBranchMetadata }
  | {
      readonly status: "conflicts";
      readonly conflicts: readonly WorkspaceMergeConflict[];
      readonly comparison: WorkspaceBranchComparison;
    };
```

Existing `GetCapabilities` should gain optional branch capability metadata:

```ts
features: {
  branches: boolean;
  review: boolean;
  merge: boolean;
}
```

If adding fields is too disruptive, create a separate branch capabilities RPC
first and fold it into `WorkspaceCapabilities` later.

## Addressing Branches

The active branch can be selected by URL or by client construction:

```text
/demo/:workspaceId                 main branch
/demo/:workspaceId/branches/:id    draft branch
/w/:workspaceId                    main branch alias
/w/:workspaceId/b/:id              draft branch alias
```

For RPC:

```text
POST /v1/workspaces/:workspaceId/branches/:branchId/rpc
POST /v1/workspaces/:workspaceId/branch-rpc
```

The first route edits a branch through the existing workspace RPC group. The
second route handles branch management operations. Local filesystem mode can use
the same shapes under the local server:

```text
POST /v1/workspace/branches/:branchId/rpc
POST /v1/workspace/branch-rpc
```

## In-Memory Implementation

Add a branch-aware memory repository used by the playground and tests:

```ts
createMemoryWorkspaceBranchRepository({
  schema,
  defaultFormat,
  initialFiles,
})
```

Implementation notes:

- Store a `Map<branchId, WorkspaceBranchState>`.
- Initialize `main` from the current `createMemoryWorkspaceClient` state.
- `createBranch` clones the selected branch's current files into a new
  `VersionedWorkspaceState`.
- The branch-specific workspace client wraps one branch and reuses existing
  `applyWorkspaceChange`, preview, reflection, and watch logic.
- Branch management publishes updates so the UI can refresh branch lists after
  create/merge/delete.
- This backend is process-local and resets on page reload, matching existing
  memory mode behavior.

MVP memory branch URLs can encode branch IDs in the hash/query string, but the
repository should not depend on URL state.

## Cloudflare Durable Object Implementation

The Durable Object should own all branches for one hosted workspace. This keeps
branch creation, edits, compare, and merge serialized through one coordination
point.

### Storage Shape

The current object stores metadata and files with key prefixes. Extend that
model first; move to SQLite tables only if the key-value shape becomes painful.

Suggested key prefixes:

```text
workspace:metadata
branch:<branchId>:metadata
branch:<branchId>:file:<encodedPath>
branch:<branchId>:change:<paddedRevision>
```

Every existing hosted workspace can be migrated lazily:

1. If `workspace:metadata` does not exist but old `metadata` exists, create
   `workspace:metadata`.
2. Create `branch:main:metadata`.
3. Move or mirror old `file:*` entries into `branch:main:file:*`.
4. Continue reading old keys only as a fallback until a migration flag exists.

### Cloudflare Operations

- `POST /v1/workspaces` creates a workspace with an explicit `main` branch.
- `GET /v1/workspaces/:workspaceId/branches` lists branch metadata.
- `POST /v1/workspaces/:workspaceId/branches` creates a draft branch from main
  or a selected branch/revision.
- `POST /v1/workspaces/:workspaceId/branches/:branchId/rpc` edits that branch.
- `POST /v1/workspaces/:workspaceId/branch-rpc` handles compare and merge.

Merge should run inside a Durable Object transaction:

1. Read source branch metadata/files.
2. Read target branch metadata/files.
3. Read base files referenced by source branch.
4. Compute merge result.
5. If conflicts exist, return conflicts and write nothing.
6. If merge succeeds, write target branch files and append a merge change.
7. Update target metadata revision/head/updatedAt.
8. Optionally archive/delete the source branch.

For MVP, store the branch base snapshot directly when creating a branch:

```text
branch:<branchId>:base-file:<encodedPath>
```

This duplicates data, but it makes three-way merges simple and reliable without
requiring full revision graph reconstruction. Later, base snapshots can be
deduplicated into commit objects.

### Cloudflare Watch Behavior

Current hosted workspaces report `watch: false`. Branches can keep that behavior
initially. Merge and branch updates should be visible after an explicit refresh
or polling. WebSocket watch can be added after the branch APIs are stable.

## Filesystem Implementation

Filesystem mode has two possible implementations. Prefer real Git worktrees
when safe and available; otherwise use directory copies managed by Schema IDE.

### Strategy A: Real Git Worktrees

Use this when:

- the workspace root is inside a Git repository,
- `git` is available,
- the working tree is clean enough for the requested operation, and
- the user has enabled Git-backed branches.

Suggested layout:

```text
repo/
  .git/
  workspace-files...
../.schema-ide-worktrees/
  <workspace-id>/
    <branch-id>/
```

Operations:

- Create branch:
  - `git worktree add -b schema-ide/<branchId> <worktreePath> HEAD`
  - or create from a specific commit if the main workspace maps cleanly to Git.
- Edit branch:
  - run the existing filesystem workspace client pointed at the worktree path.
- Review:
  - use `git diff` when the branch has Git commits,
  - otherwise compare file snapshots through the core diff function.
- Merge:
  - use core merge for Schema IDE file content first,
  - write merged files to the target workspace,
  - leave Git commit/stage behavior explicit and opt-in.

Important: do not silently commit, reset, checkout, or delete user changes.
The Schema IDE merge is a workspace content merge, not an automatic Git history
rewrite.

### Strategy B: Managed Directory Copies

Use this when Git-backed worktrees are disabled or unavailable.

Suggested layout inside or beside the workspace root:

```text
.schema-ide/
  branches.json
  branches/
    main/
      files/...
    <branchId>/
      files/...
      base/...
```

This fallback should:

- copy only files included by the workspace include/exclude rules,
- preserve binary sidecar files as bytes,
- store branch metadata in `branches.json`,
- use the same core compare/merge logic as memory and Cloudflare,
- never include `.schema-ide/**` in workspace schema validation.

The local server can expose branch-specific filesystem clients by pointing the
existing `createLocalFilesystemWorkspaceClient` at the branch directory.

### Main Branch for Filesystem

For filesystem mode, main branch can be either:

- the actual workspace root, or
- a managed copy under `.schema-ide/branches/main`.

Recommended MVP: keep main as the actual workspace root. Draft branches live in
managed copies or Git worktrees. Merge writes back into the actual workspace
root only after a successful review/merge request.

## UI Plan

Add branch controls to `SchemaIdeWorkspaceView` without changing the core file
editing layout:

- Branch selector in the workspace toolbar.
- "New branch" action.
- Current branch badge next to workspace title.
- Review panel for draft branches.
- Changed files list with per-file open action.
- Merge button targeting main.
- Conflict state with clear options: keep main, keep branch, or cancel.

The editor should keep using the current `SchemaIdeWorkspaceStore` for files and
drafts. Switching branches should dispose the current store and create a new
store for the selected branch's workspace service.

For the first UI iteration, review can be a side panel with:

- summary counts,
- changed file paths,
- before/after text diff for text files,
- binary changed indicator for binary files,
- validation summary,
- merge/conflict status.

## Agent Flow

Branches are especially useful for agent edits:

1. User asks the agent to make a change.
2. The agent runtime creates a draft branch for the turn.
3. Agent tool calls edit the draft branch only.
4. The chat panel shows a review summary when the turn completes.
5. User can inspect the branch and merge it into main.

This avoids agent edits landing directly in main and gives a natural rollback
boundary. The agent toolkit should accept a branch-scoped workspace service, so
existing write tools continue to work.

## Compatibility and Migration

- Existing memory workspaces behave as a single `main` branch until branch UI is
  used.
- Existing local filesystem mode continues to edit the actual root on `main`.
- Existing Cloudflare hosted workspaces lazily migrate old top-level files into
  `main`.
- Existing `/v1/workspace/rpc` remains valid and maps to `main`.
- Existing `/v1/workspaces/:workspaceId/rpc` or `/demo/:workspaceId/rpc` routes
  should remain aliases for `main` if already shipped.

## Implementation Phases

### Phase 1: Core Branch Model

- Add branch metadata, comparison, conflict, and merge result types.
- Add pure file diff and three-way merge helpers.
- Add tests for add/modify/delete/rename/conflict cases.
- Keep the implementation independent of React, Cloudflare, CLI, and Effect
  RPC.

### Phase 2: Memory Branch Repository

- Add a branch-aware memory repository.
- Adapt `createMemoryWorkspaceClient` or add a sibling factory that creates a
  branch-scoped `SchemaIdeWorkspaceService`.
- Add unit tests for create branch, edit branch, compare, merge, and conflict.
- Use memory branches as the contract-test baseline for protocol behavior.

### Phase 3: Protocol and Server RPC

- Add `SchemaIdeWorkspaceBranchRpcGroup`.
- Add shared RPC handler builders in `@schema-ide/server`.
- Add branch capabilities.
- Add contract tests covering list/create/compare/merge/delete.
- Keep old workspace RPC unchanged.

### Phase 4: Cloudflare Branches

- Extend `SchemaIdeWorkspaceObject` storage for branch metadata/files/base
  snapshots.
- Lazily migrate old hosted workspace storage into `main`.
- Add branch routes in `worker-runtime.ts`.
- Route branch-specific workspace RPC to the selected branch.
- Add Durable Object tests for transactions and conflict responses.

### Phase 5: Filesystem Branches

- Add a local branch manager in the CLI/server package.
- Implement managed directory-copy branches first.
- Add optional Git worktree support behind an explicit config flag.
- Add path safety and cleanup tests.
- Add tests proving merge writes back to the real workspace root only after a
  successful merge.

### Phase 6: React UI

- Add branch selector and branch creation action.
- Add review panel and changed-files list.
- Add merge action and conflict display.
- Add branch-aware route resolution for hosted and local modes.
- Add Playwright coverage for create branch, edit, review, merge, and refresh.

### Phase 7: Agent Integration

- Create agent branches automatically for agent turns when branch support is
  available.
- Show a "review agent branch" state after the turn completes.
- Merge only after explicit user action.
- Fall back to current direct-edit behavior when branch support is unavailable.

## Testing Plan

- Core unit tests for three-way merge edge cases.
- Protocol contract tests against memory branch repository.
- Cloudflare tests with Durable Object storage persistence.
- CLI filesystem tests using temporary directories.
- Optional Git worktree tests gated on `git --version`.
- React store tests for branch switching and stale snapshot handling.
- Playwright smoke tests:
  - create branch,
  - edit a file,
  - compare against main,
  - merge,
  - confirm main changed,
  - create conflicting edits,
  - confirm conflict response preserves both branches.

## Non-Goals for MVP

- Real-time collaborative branch editing.
- Line-level automatic conflict resolution.
- Automatic Git commits, rebases, pushes, or pull requests.
- Branch permissions or ownership.
- Workspace branch listing across users/accounts.
- Long-term archive pruning policies.
- Deduplicated commit-object storage.

## Open Questions

- Should branches be exposed to all users immediately, or only for agent edits
  first?
- Should Cloudflare branch URLs include unguessable branch IDs, separate share
  tokens, or both?
- Should filesystem Git worktree support be opt-in per workspace config or a CLI
  flag?
- Should successful merge delete, archive, or keep the draft branch by default?
- Should branch compare use text diffs in the protocol, or should the UI compute
  text diffs from before/after file contents?
- How should binary files participate in Cloudflare and filesystem branch
  compare beyond path/content hash changes?
