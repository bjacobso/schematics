import type { SchemaIdeValidationSummary, SourceFile } from "./types";
import { normalizePath } from "./virtual-fs";
import {
  applyWorkspaceChange,
  createVersionedWorkspace,
  getCurrentWorkspaceRevision,
  type VersionedWorkspaceState,
  type WorkspaceRevisionActor,
  type WorkspaceRevisionMetadata,
} from "./workspace-history";

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
  readonly createdBy?: WorkspaceRevisionActor | undefined;
  readonly title?: string | undefined;
}

export interface WorkspaceBranchState {
  readonly metadata: WorkspaceBranchMetadata;
  readonly workspace: VersionedWorkspaceState;
}

export interface CreateWorkspaceBranchInput {
  readonly id: string;
  readonly name?: string | undefined;
  readonly kind?: WorkspaceBranchKind | undefined;
  readonly sourceBranch?: WorkspaceBranchState | undefined;
  readonly files?: readonly SourceFile[] | undefined;
  readonly baseBranchId?: string | null | undefined;
  readonly baseRevisionId?: string | null | undefined;
  readonly createdAt?: number | undefined;
  readonly updatedAt?: number | undefined;
  readonly createdBy?: WorkspaceRevisionActor | undefined;
  readonly title?: string | undefined;
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

export type WorkspaceMergeConflictType = "content" | "delete-modify" | "add-add" | "rename";

export interface WorkspaceMergeConflict {
  readonly type: WorkspaceMergeConflictType;
  readonly path: string;
  readonly base: SourceFile | null;
  readonly source: SourceFile | null;
  readonly target: SourceFile | null;
}

export interface WorkspaceBranchComparison {
  readonly baseRevisionId: string | null;
  readonly sourceBranchId: string;
  readonly targetBranchId: string;
  readonly files: readonly WorkspaceFileDiff[];
  readonly validationSummary: SchemaIdeValidationSummary;
  readonly mergeable: boolean;
  readonly conflicts: readonly WorkspaceMergeConflict[];
}

export interface CompareWorkspaceBranchesInput {
  readonly sourceBranch: WorkspaceBranchState;
  readonly targetBranch: WorkspaceBranchState;
  readonly baseFiles?: readonly SourceFile[] | undefined;
  readonly validationSummary?: SchemaIdeValidationSummary | undefined;
}

export interface MergeWorkspaceFilesInput {
  readonly baseFiles: readonly SourceFile[];
  readonly targetFiles: readonly SourceFile[];
  readonly sourceFiles: readonly SourceFile[];
  readonly strategy?: WorkspaceBranchMergeStrategy | undefined;
}

export type WorkspaceBranchMergeStrategy = "three-way" | "source-wins" | "target-wins";

export type WorkspaceFilesMergeResult =
  | { readonly status: "merged"; readonly files: readonly SourceFile[] }
  | { readonly status: "conflicts"; readonly conflicts: readonly WorkspaceMergeConflict[] };

export interface MergeWorkspaceBranchInput extends CompareWorkspaceBranchesInput {
  readonly strategy?: WorkspaceBranchMergeStrategy | undefined;
  readonly metadata?: WorkspaceRevisionMetadata | undefined;
}

export type WorkspaceBranchMergeResult =
  | {
      readonly status: "merged";
      readonly targetBranch: WorkspaceBranchState;
      readonly files: readonly SourceFile[];
    }
  | {
      readonly status: "conflicts";
      readonly conflicts: readonly WorkspaceMergeConflict[];
      readonly comparison: WorkspaceBranchComparison;
    };

const emptyValidationSummary: SchemaIdeValidationSummary = {
  valid: true,
  errorCount: 0,
  warningCount: 0,
  infoCount: 0,
};

export function createWorkspaceBranch(input: CreateWorkspaceBranchInput): WorkspaceBranchState {
  const now = input.createdAt ?? Date.now();
  const files = input.files ?? input.sourceBranch?.workspace.files ?? [];
  const workspace = createVersionedWorkspace(files);
  const sourceHeadRevisionId = input.sourceBranch
    ? currentRevisionId(input.sourceBranch.workspace)
    : null;
  const metadata: WorkspaceBranchMetadata = {
    id: input.id,
    name: input.name ?? input.id,
    kind: input.kind ?? (input.sourceBranch ? "draft" : "main"),
    baseBranchId:
      input.baseBranchId !== undefined
        ? input.baseBranchId
        : (input.sourceBranch?.metadata.id ?? null),
    baseRevisionId:
      input.baseRevisionId !== undefined
        ? input.baseRevisionId
        : (input.sourceBranch?.metadata.headRevisionId ?? sourceHeadRevisionId),
    headRevisionId: currentRevisionId(workspace),
    createdAt: now,
    updatedAt: input.updatedAt ?? now,
    createdBy: input.createdBy,
    title: input.title,
  };

  return { metadata, workspace };
}

export function compareWorkspaceFiles(
  beforeFiles: readonly SourceFile[],
  afterFiles: readonly SourceFile[],
): readonly WorkspaceFileDiff[] {
  const before = filesByPath(beforeFiles);
  const after = filesByPath(afterFiles);
  const added: SourceFile[] = [];
  const deleted: SourceFile[] = [];
  const modified: WorkspaceFileDiff[] = [];

  for (const path of sortedUnion(before, after)) {
    const beforeFile = before.get(path) ?? null;
    const afterFile = after.get(path) ?? null;
    if (!beforeFile && afterFile) {
      added.push(afterFile);
    } else if (beforeFile && !afterFile) {
      deleted.push(beforeFile);
    } else if (beforeFile && afterFile && beforeFile.content !== afterFile.content) {
      modified.push({ type: "modified", path, before: beforeFile, after: afterFile });
    }
  }

  const diffs: WorkspaceFileDiff[] = [];
  const unmatchedAdded = new Set(added.map((file) => file.path));
  const unmatchedDeleted = new Set(deleted.map((file) => file.path));

  for (const beforeFile of deleted) {
    const afterFile = added.find(
      (candidate) =>
        unmatchedAdded.has(candidate.path) &&
        candidate.content === beforeFile.content &&
        candidate.path !== beforeFile.path,
    );
    if (!afterFile) continue;
    unmatchedDeleted.delete(beforeFile.path);
    unmatchedAdded.delete(afterFile.path);
    diffs.push({
      type: "renamed",
      fromPath: beforeFile.path,
      toPath: afterFile.path,
      before: beforeFile,
      after: afterFile,
    });
  }

  for (const file of deleted) {
    if (unmatchedDeleted.has(file.path)) {
      diffs.push({ type: "deleted", path: file.path, before: file });
    }
  }
  diffs.push(...modified);
  for (const file of added) {
    if (unmatchedAdded.has(file.path)) {
      diffs.push({ type: "added", path: file.path, after: file });
    }
  }

  return diffs.sort(compareFileDiffs);
}

export function detectWorkspaceBranchConflicts(
  input: MergeWorkspaceFilesInput,
): readonly WorkspaceMergeConflict[] {
  const result = mergeWorkspaceFiles(input);
  return result.status === "conflicts" ? result.conflicts : [];
}

export function compareWorkspaceBranches(
  input: CompareWorkspaceBranchesInput,
): WorkspaceBranchComparison {
  const baseFiles = input.baseFiles ?? input.targetBranch.workspace.files;
  const conflicts = detectWorkspaceBranchConflicts({
    baseFiles,
    targetFiles: input.targetBranch.workspace.files,
    sourceFiles: input.sourceBranch.workspace.files,
  });

  return {
    baseRevisionId: input.sourceBranch.metadata.baseRevisionId,
    sourceBranchId: input.sourceBranch.metadata.id,
    targetBranchId: input.targetBranch.metadata.id,
    files: compareWorkspaceFiles(baseFiles, input.sourceBranch.workspace.files),
    validationSummary: input.validationSummary ?? emptyValidationSummary,
    mergeable: conflicts.length === 0,
    conflicts,
  };
}

export function mergeWorkspaceFiles(input: MergeWorkspaceFilesInput): WorkspaceFilesMergeResult {
  const strategy = input.strategy ?? "three-way";
  const base = filesByPath(input.baseFiles);
  const target = filesByPath(input.targetFiles);
  const source = filesByPath(input.sourceFiles);
  const merged = new Map<string, SourceFile>();
  const conflicts: WorkspaceMergeConflict[] = [];

  for (const path of sortedUnion(base, target, source)) {
    const baseFile = base.get(path) ?? null;
    const targetFile = target.get(path) ?? null;
    const sourceFile = source.get(path) ?? null;
    const sourceChanged = !sameFile(baseFile, sourceFile);
    const targetChanged = !sameFile(baseFile, targetFile);

    if (!sourceChanged) {
      putIfPresent(merged, targetFile);
      continue;
    }
    if (!targetChanged || sameFile(sourceFile, targetFile)) {
      putIfPresent(merged, sourceFile);
      continue;
    }

    if (strategy === "source-wins") {
      putIfPresent(merged, sourceFile);
    } else if (strategy === "target-wins") {
      putIfPresent(merged, targetFile);
    } else {
      conflicts.push({
        type: conflictType(baseFile, sourceFile, targetFile),
        path,
        base: baseFile,
        source: sourceFile,
        target: targetFile,
      });
    }
  }

  if (conflicts.length > 0) {
    return { status: "conflicts", conflicts };
  }

  return { status: "merged", files: sortFiles([...merged.values()]) };
}

export function mergeWorkspaceBranch(input: MergeWorkspaceBranchInput): WorkspaceBranchMergeResult {
  const baseFiles = input.baseFiles ?? input.targetBranch.workspace.files;
  const merge = mergeWorkspaceFiles({
    baseFiles,
    targetFiles: input.targetBranch.workspace.files,
    sourceFiles: input.sourceBranch.workspace.files,
    strategy: input.strategy,
  });

  if (merge.status === "conflicts") {
    return {
      status: "conflicts",
      conflicts: merge.conflicts,
      comparison: compareWorkspaceBranches(input),
    };
  }

  const metadata = input.metadata ?? {
    actor: "system",
    label: `Merge ${input.sourceBranch.metadata.name}`,
  };
  const workspace = applyWorkspaceChange(
    input.targetBranch.workspace,
    { type: "replaceFiles", files: merge.files },
    metadata,
  );
  const targetBranch: WorkspaceBranchState = {
    metadata: {
      ...input.targetBranch.metadata,
      headRevisionId: currentRevisionId(workspace),
      updatedAt: metadata.timestamp ?? Date.now(),
    },
    workspace,
  };

  return { status: "merged", targetBranch, files: merge.files };
}

function currentRevisionId(workspace: VersionedWorkspaceState): string | null {
  return getCurrentWorkspaceRevision(workspace)?.id ?? null;
}

function filesByPath(files: readonly SourceFile[]): Map<string, SourceFile> {
  const byPath = new Map<string, SourceFile>();
  for (const file of files) {
    const path = normalizePath(file.path);
    byPath.set(path, { path, content: file.content });
  }
  return byPath;
}

function sortedUnion(...maps: readonly ReadonlyMap<string, SourceFile>[]): readonly string[] {
  const paths = new Set<string>();
  for (const map of maps) {
    for (const path of map.keys()) paths.add(path);
  }
  return [...paths].sort((left, right) => left.localeCompare(right));
}

function sortFiles(files: readonly SourceFile[]): readonly SourceFile[] {
  return [...files].sort((left, right) => left.path.localeCompare(right.path));
}

function sameFile(left: SourceFile | null, right: SourceFile | null): boolean {
  return left?.path === right?.path && left?.content === right?.content;
}

function putIfPresent(files: Map<string, SourceFile>, file: SourceFile | null): void {
  if (file) files.set(file.path, file);
}

function conflictType(
  base: SourceFile | null,
  source: SourceFile | null,
  target: SourceFile | null,
): WorkspaceMergeConflictType {
  if (!base && source && target) return "add-add";
  if (base && (!source || !target)) return "delete-modify";
  return "content";
}

function compareFileDiffs(left: WorkspaceFileDiff, right: WorkspaceFileDiff): number {
  return diffSortPath(left).localeCompare(diffSortPath(right));
}

function diffSortPath(diff: WorkspaceFileDiff): string {
  return diff.type === "renamed" ? `${diff.fromPath}\0${diff.toPath}` : diff.path;
}
