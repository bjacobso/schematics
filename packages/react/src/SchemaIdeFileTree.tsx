import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, File, Folder, FolderOpen } from "lucide-react";
import type { SourceFile } from "@schema-ide/core";
import { Badge, Button, ScrollArea } from "@schema-ide/ui";
import type { SchemaIdeFileDiagnosticCount } from "./diagnostics";

export interface SchemaIdeFileTreeProps {
  readonly files: readonly SourceFile[];
  readonly activePath: string | null | undefined;
  readonly diagnosticCounts?: ReadonlyMap<string, SchemaIdeFileDiagnosticCount> | undefined;
  readonly dirtyPaths?: ReadonlySet<string> | undefined;
  readonly conflictPaths?: ReadonlySet<string> | undefined;
  readonly onSelectFile: (path: string) => void;
}

type FileTreeNode = FileTreeDirectoryNode | FileTreeFileNode;

interface FileTreeDirectoryNode {
  readonly type: "directory";
  readonly name: string;
  readonly path: string;
  readonly children: readonly FileTreeNode[];
  readonly meta: FileTreeMeta;
}

interface FileTreeFileNode {
  readonly type: "file";
  readonly name: string;
  readonly path: string;
  readonly file: SourceFile;
  readonly meta: FileTreeMeta;
}

interface MutableDirectoryNode {
  readonly type: "directory";
  readonly name: string;
  readonly path: string;
  readonly directories: Map<string, MutableDirectoryNode>;
  readonly files: FileTreeFileNode[];
}

interface FileTreeMeta {
  readonly issueCount: number;
  readonly hasErrors: boolean;
  readonly dirty: boolean;
  readonly conflict: boolean;
}

const emptyMeta: FileTreeMeta = {
  issueCount: 0,
  hasErrors: false,
  dirty: false,
  conflict: false,
};

export function SchemaIdeFileTree({
  files,
  activePath,
  diagnosticCounts,
  dirtyPaths,
  conflictPaths,
  onSelectFile,
}: SchemaIdeFileTreeProps) {
  const [collapsedDirectories, setCollapsedDirectories] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const tree = useMemo(
    () => buildFileTree({ files, diagnosticCounts, dirtyPaths, conflictPaths }),
    [conflictPaths, diagnosticCounts, dirtyPaths, files],
  );

  useEffect(() => {
    if (!activePath) return;
    const ancestors = directoryAncestors(activePath);
    if (!ancestors.length) return;
    setCollapsedDirectories((current) => {
      let changed = false;
      const next = new Set(current);
      for (const ancestor of ancestors) {
        changed = next.delete(ancestor) || changed;
      }
      return changed ? next : current;
    });
  }, [activePath]);

  const toggleDirectory = (path: string) => {
    setCollapsedDirectories((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="p-2">
        {tree.children.map((node) => (
          <FileTreeNodeView
            key={node.path}
            node={node}
            activePath={activePath}
            collapsedDirectories={collapsedDirectories}
            depth={0}
            onSelectFile={onSelectFile}
            onToggleDirectory={toggleDirectory}
          />
        ))}
      </div>
    </ScrollArea>
  );
}

function FileTreeNodeView({
  node,
  activePath,
  collapsedDirectories,
  depth,
  onSelectFile,
  onToggleDirectory,
}: {
  readonly node: FileTreeNode;
  readonly activePath: string | null | undefined;
  readonly collapsedDirectories: ReadonlySet<string>;
  readonly depth: number;
  readonly onSelectFile: (path: string) => void;
  readonly onToggleDirectory: (path: string) => void;
}) {
  if (node.type === "directory") {
    const collapsed = collapsedDirectories.has(node.path);
    return (
      <div>
        <Button
          variant="ghost"
          className="mb-1 h-7 w-full justify-start gap-1 rounded px-1.5 text-xs"
          style={{ paddingLeft: depth * 12 + 6 }}
          onClick={() => onToggleDirectory(node.path)}
          title={node.path}
        >
          {collapsed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          {collapsed ? <Folder className="size-3.5" /> : <FolderOpen className="size-3.5" />}
          <span className="min-w-0 flex-1 truncate text-left">{node.name}</span>
          <FileTreeBadges meta={node.meta} />
        </Button>
        {collapsed
          ? null
          : node.children.map((child) => (
              <FileTreeNodeView
                key={child.path}
                node={child}
                activePath={activePath}
                collapsedDirectories={collapsedDirectories}
                depth={depth + 1}
                onSelectFile={onSelectFile}
                onToggleDirectory={onToggleDirectory}
              />
            ))}
      </div>
    );
  }

  const active = activePath === node.path;
  return (
    <button
      className={`mb-1 flex h-7 w-full items-center gap-1.5 rounded px-1.5 text-left text-xs ${
        active ? "bg-primary text-primary-foreground" : "hover:bg-muted"
      }`}
      style={{ paddingLeft: depth * 12 + 24 }}
      onClick={() => onSelectFile(node.path)}
      title={node.path}
    >
      <File className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{node.name}</span>
      <FileTreeBadges meta={node.meta} />
    </button>
  );
}

function FileTreeBadges({ meta }: { readonly meta: FileTreeMeta }) {
  return (
    <>
      {meta.conflict ? <AlertTriangle className="size-3.5 shrink-0 text-destructive" /> : null}
      {meta.dirty ? <Badge className="h-4 shrink-0 px-1.5 text-[10px]">Dirty</Badge> : null}
      {meta.issueCount ? (
        <Badge
          variant={meta.hasErrors ? "destructive" : "secondary"}
          className="h-4 min-w-4 shrink-0 px-1.5 text-[10px]"
        >
          {meta.issueCount}
        </Badge>
      ) : null}
    </>
  );
}

function buildFileTree({
  files,
  diagnosticCounts,
  dirtyPaths,
  conflictPaths,
}: {
  readonly files: readonly SourceFile[];
  readonly diagnosticCounts: ReadonlyMap<string, SchemaIdeFileDiagnosticCount> | undefined;
  readonly dirtyPaths: ReadonlySet<string> | undefined;
  readonly conflictPaths: ReadonlySet<string> | undefined;
}): FileTreeDirectoryNode {
  const root: MutableDirectoryNode = {
    type: "directory",
    name: "",
    path: "",
    directories: new Map(),
    files: [],
  };

  for (const file of files) {
    const parts = file.path.split("/").filter(Boolean);
    if (!parts.length) continue;

    let current = root;
    for (const part of parts.slice(0, -1)) {
      const path = joinTreePath(current.path, part);
      const existing = current.directories.get(part);
      if (existing) {
        current = existing;
      } else {
        const directory: MutableDirectoryNode = {
          type: "directory",
          name: part,
          path,
          directories: new Map(),
          files: [],
        };
        current.directories.set(part, directory);
        current = directory;
      }
    }

    current.files.push({
      type: "file",
      name: parts[parts.length - 1] ?? file.path,
      path: file.path,
      file,
      meta: metaForFile({ path: file.path, diagnosticCounts, dirtyPaths, conflictPaths }),
    });
  }

  return freezeDirectory(root);
}

function freezeDirectory(directory: MutableDirectoryNode): FileTreeDirectoryNode {
  const directories = [...directory.directories.values()].map(freezeDirectory);
  const files = [...directory.files].sort(compareNodes);
  const children = [...directories.sort(compareNodes), ...files];
  const meta = children.reduce<FileTreeMeta>(
    (current, child) => combineMeta(current, child.meta),
    emptyMeta,
  );
  return {
    type: "directory",
    name: directory.name,
    path: directory.path,
    children,
    meta,
  };
}

function metaForFile({
  path,
  diagnosticCounts,
  dirtyPaths,
  conflictPaths,
}: {
  readonly path: string;
  readonly diagnosticCounts: ReadonlyMap<string, SchemaIdeFileDiagnosticCount> | undefined;
  readonly dirtyPaths: ReadonlySet<string> | undefined;
  readonly conflictPaths: ReadonlySet<string> | undefined;
}): FileTreeMeta {
  const counts = diagnosticCounts?.get(path);
  return {
    issueCount: counts ? counts.errors || counts.warnings || counts.infos : 0,
    hasErrors: Boolean(counts?.errors),
    dirty: Boolean(dirtyPaths?.has(path)),
    conflict: Boolean(conflictPaths?.has(path)),
  };
}

function combineMeta(left: FileTreeMeta, right: FileTreeMeta): FileTreeMeta {
  return {
    issueCount: left.issueCount + right.issueCount,
    hasErrors: left.hasErrors || right.hasErrors,
    dirty: left.dirty || right.dirty,
    conflict: left.conflict || right.conflict,
  };
}

function compareNodes(left: Pick<FileTreeNode, "name">, right: Pick<FileTreeNode, "name">) {
  return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" });
}

function directoryAncestors(path: string): readonly string[] {
  const parts = path.split("/").filter(Boolean);
  return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join("/"));
}

function joinTreePath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name;
}
