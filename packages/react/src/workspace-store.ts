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
  readonly stateRef: AtomRef.AtomRef<SchemaIdeWorkspaceState>;
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

export function createSchemaIdeWorkspaceStore(
  client: SchemaIdeWorkspaceClient,
): SchemaIdeWorkspaceStore {
  const stateRef = AtomRef.make(initialState);
  let subscription: WorkspaceWatchSubscription | null = null;
  let session = 0;

  const isCurrentSession = (currentSession: number) => session === currentSession;

  const setError = (error: unknown) => {
    stateRef.update((state) => ({
      ...state,
      error: error instanceof Error ? error.message : String(error),
    }));
  };

  const applySnapshot = (snapshot: WorkspaceSnapshot) => {
    stateRef.update((state) => {
      if (state.snapshot && snapshot.revision < state.snapshot.revision) {
        return state;
      }
      const conflicts = detectDraftConflicts({
        previous: state.snapshot,
        next: snapshot,
        drafts: state.drafts,
        currentConflicts: state.conflicts,
      });

      return {
        ...state,
        snapshot,
        activeFile: selectActiveFile(state.activeFile, snapshot.files),
        conflicts,
      };
    });
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
    start: () => {
      if (subscription) return;
      const currentSession = ++session;

      void client
        .getCapabilities()
        .then((capabilities) => {
          if (!isCurrentSession(currentSession)) return;
          stateRef.update((state) => ({ ...state, capabilities }));
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
              stateRef.update((state) => ({ ...state, capabilities: event.capabilities }));
              return;
            }
            if (event.type === "error") {
              stateRef.update((state) => ({ ...state, error: event.message }));
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
      stateRef.update((state) => ({ ...state, activeFile: path }));
    },
    updateActiveFile: (content) => {
      const state = stateRef.value;
      if (isReadOnly(state)) return;
      const selectedFile = getSelectedFile(state);
      if (!selectedFile) return;
      stateRef.update((current) => ({
        ...current,
        drafts: { ...current.drafts, [selectedFile.path]: content },
      }));
    },
    refreshSnapshot,
    applyWorkspaceChange: applyChange,
    saveActiveFile: async () => {
      const state = stateRef.value;
      if (isReadOnly(state)) return;
      const selectedFile = getSelectedFile(state);
      if (!selectedFile) return;

      try {
        await applyChange({
          type: "writeFile",
          path: selectedFile.path,
          content: selectedFile.content,
        });
        stateRef.update((current) => ({
          ...current,
          drafts: omitKey(current.drafts, selectedFile.path),
          conflicts: omitKey(current.conflicts, selectedFile.path),
        }));
      } catch (error) {
        setError(error);
      }
    },
    discardActiveDraft: () => {
      const selectedFile = getSelectedFile(stateRef.value);
      if (!selectedFile) return;
      stateRef.update((current) => ({
        ...current,
        drafts: omitKey(current.drafts, selectedFile.path),
        conflicts: omitKey(current.conflicts, selectedFile.path),
      }));
    },
    addFile: async () => {
      const state = stateRef.value;
      if (isReadOnly(state)) return;
      const files = getFiles(state);
      let index = files.length + 1;
      let path = `new-file-${index}.json`;
      while (files.some((file) => file.path === path)) {
        index += 1;
        path = `new-file-${index}.json`;
      }

      try {
        await applyChange({ type: "createFile", path, content: "{}\n" });
        stateRef.update((current) => ({ ...current, activeFile: path }));
      } catch (error) {
        setError(error);
      }
    },
    deleteActiveFile: async () => {
      const state = stateRef.value;
      if (isReadOnly(state)) return;
      if (!state.capabilities?.features.delete) return;
      const selectedFile = getSelectedFile(state);
      if (!selectedFile) return;

      try {
        await applyChange({ type: "deleteFile", path: selectedFile.path });
        stateRef.update((current) => ({
          ...current,
          drafts: omitKey(current.drafts, selectedFile.path),
          conflicts: omitKey(current.conflicts, selectedFile.path),
        }));
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
    const committedFiles = state.snapshot?.files ?? [];
    const files = applyDraftsToFiles(committedFiles, state.drafts);
    const selectedFile = state.activeFile
      ? (files.find((file) => file.path === state.activeFile) ?? null)
      : (files[0] ?? null);
    const selectedCommittedFile = selectedFile
      ? (committedFiles.find((file) => file.path === selectedFile.path) ?? null)
      : null;

    return {
      store,
      state,
      capabilities: state.capabilities,
      snapshot: state.snapshot,
      files,
      committedFiles,
      selectedFile,
      selectedCommittedFile,
      selectedIsDirty: Boolean(
        selectedFile &&
          selectedCommittedFile &&
          selectedFile.content !== selectedCommittedFile.content,
      ),
      selectedHasConflict: Boolean(selectedFile && state.conflicts[selectedFile.path]),
      reflection: state.snapshot?.reflection ?? null,
      readOnly: isReadOnly(state),
    };
  }, [state, store]);
}

function getFiles(state: SchemaIdeWorkspaceState): readonly SourceFile[] {
  return applyDraftsToFiles(state.snapshot?.files ?? [], state.drafts);
}

function getSelectedFile(state: SchemaIdeWorkspaceState): SourceFile | null {
  const files = getFiles(state);
  return state.activeFile
    ? (files.find((file) => file.path === state.activeFile) ?? null)
    : (files[0] ?? null);
}

function isReadOnly(state: SchemaIdeWorkspaceState): boolean {
  return Boolean(state.capabilities?.workspace.readOnly || !state.capabilities?.features.write);
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
