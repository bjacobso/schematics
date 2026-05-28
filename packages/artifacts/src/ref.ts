export interface PathArtifactRef {
  readonly _tag: "Path";
  readonly path: string;
}

export interface UrlArtifactRef {
  readonly _tag: "Url";
  readonly url: string;
}

export interface BlobArtifactRef {
  readonly _tag: "Blob";
  readonly id: string;
}

export interface GitBlobArtifactRef {
  readonly _tag: "GitBlob";
  readonly repo: string;
  readonly oid: string;
}

export interface WorkspaceArtifactRef {
  readonly _tag: "Workspace";
  readonly workspaceId?: string | undefined;
}

export interface WorkspaceFileArtifactRef {
  readonly _tag: "WorkspaceFile";
  readonly path: string;
  readonly workspaceId?: string | undefined;
}

export type ArtifactRef =
  | PathArtifactRef
  | UrlArtifactRef
  | BlobArtifactRef
  | GitBlobArtifactRef
  | WorkspaceArtifactRef
  | WorkspaceFileArtifactRef;

export const ArtifactRef = {
  path: (path: string): PathArtifactRef => ({ _tag: "Path", path }),
  url: (url: string): UrlArtifactRef => ({ _tag: "Url", url }),
  blob: (id: string): BlobArtifactRef => ({ _tag: "Blob", id }),
  gitBlob: (repo: string, oid: string): GitBlobArtifactRef => ({ _tag: "GitBlob", repo, oid }),
  workspace: (workspaceId?: string): WorkspaceArtifactRef =>
    workspaceId ? { _tag: "Workspace", workspaceId } : { _tag: "Workspace" },
  workspaceFile: (path: string, workspaceId?: string): WorkspaceFileArtifactRef =>
    workspaceId ? { _tag: "WorkspaceFile", path, workspaceId } : { _tag: "WorkspaceFile", path },
} as const;

export function pathFromArtifactRef(ref: ArtifactRef): string | null {
  switch (ref._tag) {
    case "Path":
    case "WorkspaceFile":
      return ref.path;
    case "Url":
      return pathnameFromUrl(ref.url);
    case "Blob":
    case "GitBlob":
    case "Workspace":
      return null;
  }
}

export function schemeFromArtifactRef(ref: ArtifactRef): string | null {
  if (ref._tag !== "Url") return null;

  try {
    const url = new URL(ref.url);
    return url.protocol.replace(/:$/, "").toLowerCase();
  } catch {
    return null;
  }
}

function pathnameFromUrl(urlText: string): string | null {
  try {
    return new URL(urlText).pathname;
  } catch {
    return null;
  }
}
