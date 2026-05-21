import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { SourceFile } from "@schema-ide/core";
import type {
  SchemaIdeReflectionDto,
  SchemaIdeWorkspaceClient,
  WorkspaceCapabilities,
  WorkspaceChangeRequest,
  WorkspaceChangeResponse,
  WorkspaceSnapshot,
  WorkspaceWatchSubscription,
} from "@schema-ide/protocol";
import { Equal, Hash } from "effect";
import { AtomRef } from "effect/unstable/reactivity";

export interface SchemaIdeWorkspaceState {
  readonly capabilities: WorkspaceCapabilities | null;
  readonly snapshot: WorkspaceSnapshot | null;
  readonly activeFile: string | null;
  readonly drafts: Readonly<Record<string, string>>;
  readonly conflicts: Readonly<Record<string, number>>;
  readonly error: string | null;
}

export interface SchemaIdeWorkspaceStore {
  readonly stateRef: AtomRef.ReadonlyRef<SchemaIdeWorkspaceState>;
  readonly capabilitiesRef: AtomRef.ReadonlyRef<WorkspaceCapabilities | null>;
  readonly snapshotRef: AtomRef.ReadonlyRef<WorkspaceSnapshot | null>;
  readonly activeFileRef: AtomRef.ReadonlyRef<string | null>;
  readonly draftsRef: AtomRef.ReadonlyRef<Readonly<Record<string, string>>>;
  readonly conflictsRef: AtomRef.ReadonlyRef<Readonly<Record<string, number>>>;
  readonly errorRef: AtomRef.ReadonlyRef<string | null>;
  readonly committedFilesRef: AtomRef.ReadonlyRef<readonly SourceFile[]>;
  readonly filesRef: AtomRef.ReadonlyRef<readonly SourceFile[]>;
  readonly selectedFileRef: AtomRef.ReadonlyRef<SourceFile | null>;
  readonly selectedCommittedFileRef: AtomRef.ReadonlyRef<SourceFile | null>;
  readonly selectedIsDirtyRef: AtomRef.ReadonlyRef<boolean>;
  readonly selectedHasConflictRef: AtomRef.ReadonlyRef<boolean>;
  readonly reflectionRef: AtomRef.ReadonlyRef<SchemaIdeReflectionDto | null>;
  readonly readOnlyRef: AtomRef.ReadonlyRef<boolean>;
  readonly start: () => void;
  readonly stop: () => void;
  readonly setActiveFile: (path: string | null) => void;
  readonly updateActiveFile: (content: string) => void;
  readonly refreshSnapshot: () => Promise<WorkspaceSnapshot | null>;
  readonly applyWorkspaceChange: (change: WorkspaceChangeRequest) => Promise<WorkspaceChangeResponse>;
  readonly saveActiveFile: () => Promise<void>;
  readonly discardActiveDraft: () => void;
  readonly addFile: () => Promise<void>;
  readonly deleteActiveFile: () => Promise<void>;
}

export interface SchemaIdeWorkspaceViewModel {
  readonly store: SchemaIdeWorkspaceStore;
  readonly state: SchemaIdeWorkspaceState;
  readonly capabilities: WorkspaceCapabilities | null;
  readonly snapshot: WorkspaceSnapshot | null;
  readonly files: readonly SourceFile[];
  readonly committedFiles: readonly SourceFile[];
  readonly selectedFile: SourceFile | null;
  readonly selectedCommittedFile: SourceFile | null;
  readonly selectedIsDirty: boolean;
  readonly selectedHasConflict: boolean;
  readonly reflection: SchemaIdeReflectionDto | null;
  readonly readOnly: boolean;
}

const initialState: SchemaIdeWorkspaceState = {
  capabilities: null,
  snapshot: null,
  activeFile: null,
  drafts: {},
  conflicts: {},
  error: null,
};

let combinedRefId = 0;
type RefEquality<A> = (left: A, right: A) => boolean;

function combineRefs<A>(
  sources: readonly AtomRef.ReadonlyRef<unknown>[],
  evaluate: () => A,
  equals: RefEquality<A> = Equal.equals,
): AtomRef.ReadonlyRef<A> {
  let value = evaluate();
  const listeners = new Set<(value: A) => void>();
  let unsubscribeSources: readonly (() => void)[] | null = null;

  const read = () => {
    const next = evaluate();
    if (!equals(next, value)) {
      value = next;
    }
    return value;
  };

  const notifyIfChanged = () => {
    const next = evaluate();
    if (equals(next, value)) return;
    value = next;
    for (const listener of listeners) {
      listener(value);
    }
  };

  const subscribeToSources = () => {
    if (unsubscribeSources) return;
    value = evaluate();
    unsubscribeSources = sources.map((source) => source.subscribe(notifyIfChanged));
  };

  const unsubscribeFromSources = () => {
    if (!unsubscribeSources) return;
    for (const unsubscribe of unsubscribeSources) {
      unsubscribe();
    }
    unsubscribeSources = null;
  };

  const ref: AtomRef.ReadonlyRef<A> = {
    [AtomRef.TypeId]: AtomRef.TypeId,
    key: `SchemaIdeWorkspaceRef-${combinedRefId++}`,
    get value() {
      return read();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      subscribeToSources();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          unsubscribeFromSources();
        }
      };
    },
    map: (map) => combineRefs([ref], () => map(ref.value)),
    [Equal.symbol]: (that: Equal.Equal) =>
      equals(read(), (that as AtomRef.ReadonlyRef<A>).value),
    [Hash.symbol]: () => Hash.hash(read()),
  };

  return ref;
}

export function createSchemaIdeWorkspaceStore(
  client: SchemaIdeWorkspaceClient,
): SchemaIdeWorkspaceStore {
  const capabilitiesRef = AtomRef.make<WorkspaceCapabilities | null>(initialState.capabilities);
  const snapshotRef = AtomRef.make<WorkspaceSnapshot | null>(initialState.snapshot);
  const activeFileRef = AtomRef.make<string | null>(initialState.activeFile);
  const draftsRef = AtomRef.make<Readonly<Record<string, string>>>(initialState.drafts);
  const conflictsRef = AtomRef.make<Readonly<Record<string, number>>>(initialState.conflicts);
  const errorRef = AtomRef.make<string | null>(initialState.error);
  const committedFilesRef = combineRefs(
    [snapshotRef],
    () => snapshotRef.value?.files ?? [],
    sourceFilesEqual,
  );
  const filesRef = combineRefs(
    [committedFilesRef, draftsRef],
    () => applyDraftsToFiles(committedFilesRef.value, draftsRef.value),
    sourceFilesEqual,
  );
  const selectedFileRef = combineRefs(
    [activeFileRef, filesRef],
    () => selectFile(activeFileRef.value, filesRef.value),
    nullableSourceFileEqual,
  );
  const selectedCommittedFileRef = combineRefs(
    [selectedFileRef, committedFilesRef],
    () =>
      selectedFileRef.value
        ? (committedFilesRef.value.find((file) => file.path === selectedFileRef.value?.path) ??
          null)
        : null,
    nullableSourceFileEqual,
  );
  const selectedIsDirtyRef = combineRefs(
    [selectedFileRef, selectedCommittedFileRef],
    () =>
      Boolean(
        selectedFileRef.value &&
          selectedCommittedFileRef.value &&
          selectedFileRef.value.content !== selectedCommittedFileRef.value.content,
      ),
  );
  const selectedHasConflictRef = combineRefs(
    [selectedFileRef, conflictsRef],
    () => Boolean(selectedFileRef.value && conflictsRef.value[selectedFileRef.value.path]),
  );
  const reflectionRef = snapshotRef.map((snapshot) => snapshot?.reflection ?? null);
  const readOnlyRef = capabilitiesRef.map((capabilities) => isReadOnly(capabilities));
  const stateRef = combineRefs(
    [capabilitiesRef, snapshotRef, activeFileRef, draftsRef, conflictsRef, errorRef],
    () => ({
      capabilities: capabilitiesRef.value,
      snapshot: snapshotRef.value,
      activeFile: activeFileRef.value,
      drafts: draftsRef.value,
      conflicts: conflictsRef.value,
      error: errorRef.value,
    }),
    workspaceStateEqual,
  );
  let subscription: WorkspaceWatchSubscription | null = null;
  let session = 0;

  const isCurrentSession = (currentSession: number) => session === currentSession;

  const setError = (error: unknown) => {
    errorRef.set(error instanceof Error ? error.message : String(error));
  };

  const applySnapshot = (snapshot: WorkspaceSnapshot) => {
    if (snapshotRef.value && snapshot.revision < snapshotRef.value.revision) {
      return;
    }
    const conflicts = detectDraftConflicts({
      previous: snapshotRef.value,
      next: snapshot,
      drafts: draftsRef.value,
      currentConflicts: conflictsRef.value,
    });
    snapshotRef.set(snapshot);
    activeFileRef.set(selectActiveFile(activeFileRef.value, snapshot.files));
    conflictsRef.set(conflicts);
  };

  const refreshSnapshot = async (): Promise<WorkspaceSnapshot | null> => {
    try {
      const snapshot = await client.getSnapshot();
      applySnapshot(snapshot);
      return snapshot;
    } catch (error) {
      setError(error);
      return null;
    }
  };

  const applyChange = async (
    change: WorkspaceChangeRequest,
  ): Promise<WorkspaceChangeResponse> => {
    try {
      const response = await client.applyChange(change);
      await refreshSnapshot();
      return response;
    } catch (error) {
      setError(error);
      throw error;
    }
  };

  const store: SchemaIdeWorkspaceStore = {
    stateRef,
    capabilitiesRef,
    snapshotRef,
    activeFileRef,
    draftsRef,
    conflictsRef,
    errorRef,
    committedFilesRef,
    filesRef,
    selectedFileRef,
    selectedCommittedFileRef,
    selectedIsDirtyRef,
    selectedHasConflictRef,
    reflectionRef,
    readOnlyRef,
    start: () => {
      if (subscription) return;
      const currentSession = ++session;

      void client
        .getCapabilities()
        .then((capabilities) => {
          if (!isCurrentSession(currentSession)) return;
          capabilitiesRef.set(capabilities);
        })
        .catch(setError);

      void client
        .getSnapshot()
        .then((snapshot) => {
          if (!isCurrentSession(currentSession)) return;
          applySnapshot(snapshot);
        })
        .catch(setError);

      try {
        subscription = client.watchWorkspace(
          (event) => {
            if (!isCurrentSession(currentSession)) return;
            if (event.type === "capabilities") {
              capabilitiesRef.set(event.capabilities);
              return;
            }
            if (event.type === "error") {
              errorRef.set(event.message);
              return;
            }
            applySnapshot(event.snapshot);
          },
          setError,
        );
      } catch (error) {
        setError(error);
      }
    },
    stop: () => {
      session += 1;
      subscription?.unsubscribe();
      subscription = null;
    },
    setActiveFile: (path) => {
      activeFileRef.set(path);
    },
    updateActiveFile: (content) => {
      if (readOnlyRef.value) return;
      const selectedFile = selectedFileRef.value;
      if (!selectedFile) return;
      draftsRef.update((drafts) => ({ ...drafts, [selectedFile.path]: content }));
    },
    refreshSnapshot,
    applyWorkspaceChange: applyChange,
    saveActiveFile: async () => {
      if (readOnlyRef.value) return;
      const selectedFile = selectedFileRef.value;
      if (!selectedFile) return;

      try {
        await applyChange({
          type: "writeFile",
          path: selectedFile.path,
          content: selectedFile.content,
        });
        draftsRef.update((drafts) => omitKey(drafts, selectedFile.path));
        conflictsRef.update((conflicts) => omitKey(conflicts, selectedFile.path));
      } catch (error) {
        setError(error);
      }
    },
    discardActiveDraft: () => {
      const selectedFile = selectedFileRef.value;
      if (!selectedFile) return;
      draftsRef.update((drafts) => omitKey(drafts, selectedFile.path));
      conflictsRef.update((conflicts) => omitKey(conflicts, selectedFile.path));
    },
    addFile: async () => {
      if (readOnlyRef.value) return;
      const files = filesRef.value;
      let index = files.length + 1;
      let path = `new-file-${index}.json`;
      while (files.some((file) => file.path === path)) {
        index += 1;
        path = `new-file-${index}.json`;
      }

      try {
        await applyChange({ type: "createFile", path, content: "{}\n" });
        activeFileRef.set(path);
      } catch (error) {
        setError(error);
      }
    },
    deleteActiveFile: async () => {
      if (readOnlyRef.value) return;
      if (!capabilitiesRef.value?.features.delete) return;
      const selectedFile = selectedFileRef.value;
      if (!selectedFile) return;

      try {
        await applyChange({ type: "deleteFile", path: selectedFile.path });
        draftsRef.update((drafts) => omitKey(drafts, selectedFile.path));
        conflictsRef.update((conflicts) => omitKey(conflicts, selectedFile.path));
      } catch (error) {
        setError(error);
      }
    },
  };

  return store;
}

export function useSchemaIdeWorkspaceStore(
  client: SchemaIdeWorkspaceClient,
): SchemaIdeWorkspaceViewModel {
  const store = useMemo(() => createSchemaIdeWorkspaceStore(client), [client]);

  useEffect(() => {
    store.start();
    return store.stop;
  }, [store]);

  const state = useSyncExternalStore(
    (listener) => store.stateRef.subscribe(() => listener()),
    () => store.stateRef.value,
    () => store.stateRef.value,
  );

  return useMemo(() => {
    return {
      store,
      state,
      capabilities: store.capabilitiesRef.value,
      snapshot: store.snapshotRef.value,
      files: store.filesRef.value,
      committedFiles: store.committedFilesRef.value,
      selectedFile: store.selectedFileRef.value,
      selectedCommittedFile: store.selectedCommittedFileRef.value,
      selectedIsDirty: store.selectedIsDirtyRef.value,
      selectedHasConflict: store.selectedHasConflictRef.value,
      reflection: store.reflectionRef.value,
      readOnly: store.readOnlyRef.value,
    };
  }, [state, store]);
}

function selectFile(activeFile: string | null, files: readonly SourceFile[]): SourceFile | null {
  return activeFile
    ? (files.find((file) => file.path === activeFile) ?? null)
    : (files[0] ?? null);
}

function workspaceStateEqual(
  left: SchemaIdeWorkspaceState,
  right: SchemaIdeWorkspaceState,
): boolean {
  return (
    Object.is(left.capabilities, right.capabilities) &&
    workspaceSnapshotEqual(left.snapshot, right.snapshot) &&
    left.activeFile === right.activeFile &&
    recordEqual(left.drafts, right.drafts, Object.is) &&
    recordEqual(left.conflicts, right.conflicts, Object.is) &&
    left.error === right.error
  );
}

function workspaceSnapshotEqual(
  left: WorkspaceSnapshot | null,
  right: WorkspaceSnapshot | null,
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return (
    left.revision === right.revision &&
    sourceFilesEqual(left.files, right.files) &&
    Object.is(left.reflection, right.reflection)
  );
}

function nullableSourceFileEqual(left: SourceFile | null, right: SourceFile | null): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return sourceFileEqual(left, right);
}

function sourceFilesEqual(left: readonly SourceFile[], right: readonly SourceFile[]): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  return left.every((file, index) => sourceFileEqual(file, right[index]!));
}

function sourceFileEqual(left: SourceFile, right: SourceFile): boolean {
  return left.path === right.path && left.content === right.content;
}

function recordEqual<T>(
  left: Readonly<Record<string, T>>,
  right: Readonly<Record<string, T>>,
  equals: RefEquality<T>,
): boolean {
  if (left === right) return true;
  const leftKeys = Object.keys(left);
  if (leftKeys.length !== Object.keys(right).length) return false;
  return leftKeys.every((key) =>
    Object.prototype.hasOwnProperty.call(right, key) && equals(left[key]!, right[key]!),
  );
}

function isReadOnly(capabilities: WorkspaceCapabilities | null): boolean {
  return Boolean(capabilities?.workspace.readOnly || !capabilities?.features.write);
}

function selectActiveFile(
  current: string | null,
  files: readonly SourceFile[],
): string | null {
  if (current && files.some((file) => file.path === current)) {
    return current;
  }
  return files[0]?.path ?? null;
}

function detectDraftConflicts({
  previous,
  next,
  drafts,
  currentConflicts,
}: {
  readonly previous: WorkspaceSnapshot | null;
  readonly next: WorkspaceSnapshot;
  readonly drafts: Readonly<Record<string, string>>;
  readonly currentConflicts: Readonly<Record<string, number>>;
}): Readonly<Record<string, number>> {
  const draftEntries = Object.entries(drafts);
  if (!previous || !draftEntries.length) return currentConflicts;

  let conflicts = currentConflicts;
  const previousByPath = new Map(previous.files.map((file) => [file.path, file.content]));
  for (const file of next.files) {
    const draft = drafts[file.path];
    if (draft === undefined) continue;

    const previousContent = previousByPath.get(file.path);
    if (
      previousContent !== undefined &&
      previousContent !== file.content &&
      draft !== file.content
    ) {
      conflicts =
        conflicts === currentConflicts
          ? { ...currentConflicts, [file.path]: next.revision }
          : { ...conflicts, [file.path]: next.revision };
    }
  }

  return conflicts;
}

function applyDraftsToFiles(
  files: readonly SourceFile[],
  drafts: Readonly<Record<string, string>>,
): readonly SourceFile[] {
  const draftEntries = Object.entries(drafts);
  if (!draftEntries.length) return files;
  return files.map((file) =>
    Object.prototype.hasOwnProperty.call(drafts, file.path)
      ? { ...file, content: drafts[file.path] ?? file.content }
      : file,
  );
}

function omitKey<T>(record: Readonly<Record<string, T>>, key: string): Readonly<Record<string, T>> {
  const next = { ...record };
  delete next[key];
  return next;
}
