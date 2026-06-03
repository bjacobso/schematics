import { useMemo } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import {
  ArrowDownToLine,
  FilePlus2,
  FileMinus2,
  GitCompare,
  Pencil,
  Rocket,
  TriangleAlert,
} from "lucide-react";
import type { SourceFile } from "@schematics/core";

type DeployChangeKind = "added" | "modified" | "removed" | "conflict";

interface DeployChange {
  readonly path: string;
  readonly kind: DeployChangeKind;
}

export interface SchematicsDeployChangesPanelProps {
  readonly files: readonly SourceFile[];
  readonly committedFiles: readonly SourceFile[];
  readonly dirtyPaths: ReadonlySet<string>;
  readonly conflictPaths: ReadonlySet<string>;
  readonly readOnly: boolean;
  readonly onOpenFile: (path: string) => void;
  /** Push the working-tree changes to main. Disabled when no target is connected. */
  readonly onDeploy?: (() => void) | undefined;
  /** Pull changes from main back into the working tree. Disabled when no target is connected. */
  readonly onSync?: (() => void) | undefined;
}

const KIND_META: Record<
  DeployChangeKind,
  { readonly label: string; readonly icon: typeof Pencil; readonly className: string }
> = {
  added: { label: "Added", icon: FilePlus2, className: "text-green-600" },
  modified: { label: "Modified", icon: Pencil, className: "text-amber-600" },
  removed: { label: "Removed", icon: FileMinus2, className: "text-destructive" },
  conflict: { label: "Conflict", icon: TriangleAlert, className: "text-destructive" },
};

/**
 * Deploy / Sync column: shows the delta from the starting (committed) point and
 * surfaces deploy-to-main / sync-from-main actions. The lifecycle wiring lives in
 * `docs/plan-alchemy-ui.md`; the actions are disabled until a deployment
 * target is connected (`onDeploy` / `onSync` not provided).
 */
export function SchematicsDeployChangesPanel({
  files,
  committedFiles,
  dirtyPaths,
  conflictPaths,
  readOnly,
  onOpenFile,
  onDeploy,
  onSync,
}: SchematicsDeployChangesPanelProps) {
  const changes = useMemo<readonly DeployChange[]>(() => {
    const committedPaths = new Set(committedFiles.map((file) => file.path));
    const currentPaths = new Set(files.map((file) => file.path));
    const byPath = new Map<string, DeployChangeKind>();

    for (const path of dirtyPaths) {
      byPath.set(path, committedPaths.has(path) ? "modified" : "added");
    }
    for (const file of committedFiles) {
      if (!currentPaths.has(file.path)) byPath.set(file.path, "removed");
    }
    // Conflicts win over a plain modified flag.
    for (const path of conflictPaths) {
      byPath.set(path, "conflict");
    }

    return [...byPath.entries()]
      .map(([path, kind]) => ({ path, kind }))
      .sort((left, right) => left.path.localeCompare(right.path));
  }, [files, committedFiles, dirtyPaths, conflictPaths]);

  const conflictCount = changes.filter((change) => change.kind === "conflict").length;

  return (
    <div className="flex h-full min-h-0 flex-col border-l bg-muted/20">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
        <Rocket className="size-4" />
        <span className="text-sm font-medium">Deploy</span>
        <Chip className="ml-auto" label={changes.length} size="small" variant="outlined" />
      </div>

      <Box className="min-h-0 flex-1" sx={{ overflow: "auto" }}>
        <div className="p-3">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <GitCompare className="size-3.5" />
            Changes from starting point
          </div>
          {changes.length === 0 ? (
            <div className="rounded-md border bg-background p-3 text-xs text-muted-foreground">
              No changes yet. Edit a file to see it staged for deploy here.
            </div>
          ) : (
            <div className="grid gap-1">
              {changes.map((change) => {
                const meta = KIND_META[change.kind];
                const Icon = meta.icon;
                const name = change.path.split("/").pop() ?? change.path;
                return (
                  <button
                    key={change.path}
                    className="flex min-h-9 w-full min-w-0 items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
                    onClick={() => onOpenFile(change.path)}
                    title={`${meta.label} — ${change.path}`}
                    type="button"
                  >
                    <Icon className={`size-3.5 shrink-0 ${meta.className}`} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{name}</span>
                      <span className="block truncate font-mono text-[10px] text-muted-foreground">
                        {change.path}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </Box>

      <div className="shrink-0 border-t bg-background p-3">
        {conflictCount > 0 ? (
          <div className="mb-2 flex items-center gap-1.5 rounded-md border border-destructive/30 bg-destructive/10 p-2 text-[11px] text-destructive">
            <TriangleAlert className="size-3.5 shrink-0" />
            {conflictCount} conflict{conflictCount === 1 ? "" : "s"} with main — resolve before
            deploying.
          </div>
        ) : null}
        <div className="grid gap-2">
          <Button
            disabled={readOnly || !onDeploy || changes.length === 0 || conflictCount > 0}
            onClick={onDeploy}
            size="small"
            variant="contained"
          >
            <Rocket className="mr-1 size-3.5" />
            Deploy to main
          </Button>
          <Button
            color="inherit"
            disabled={readOnly || !onSync}
            onClick={onSync}
            size="small"
            variant="outlined"
          >
            <ArrowDownToLine className="mr-1 size-3.5" />
            Sync from main
          </Button>
        </div>
        {!onDeploy && !onSync ? (
          <div className="mt-2 text-[11px] text-muted-foreground">
            Connect a deployment target to deploy and sync.
          </div>
        ) : null}
      </div>
    </div>
  );
}
