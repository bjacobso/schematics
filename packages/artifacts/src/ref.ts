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

export interface ProjectArtifactRef {
  readonly _tag: "Project";
  readonly projectId?: string | undefined;
}

export interface ProjectFileArtifactRef {
  readonly _tag: "ProjectFile";
  readonly path: string;
  readonly projectId?: string | undefined;
}

export type ArtifactRef =
  | PathArtifactRef
  | UrlArtifactRef
  | BlobArtifactRef
  | GitBlobArtifactRef
  | ProjectArtifactRef
  | ProjectFileArtifactRef;

export const ArtifactRef = {
  path: (path: string): PathArtifactRef => ({ _tag: "Path", path }),
  url: (url: string): UrlArtifactRef => ({ _tag: "Url", url }),
  blob: (id: string): BlobArtifactRef => ({ _tag: "Blob", id }),
  gitBlob: (repo: string, oid: string): GitBlobArtifactRef => ({ _tag: "GitBlob", repo, oid }),
  project: (projectId?: string): ProjectArtifactRef =>
    projectId ? { _tag: "Project", projectId } : { _tag: "Project" },
  projectFile: (path: string, projectId?: string): ProjectFileArtifactRef =>
    projectId ? { _tag: "ProjectFile", path, projectId } : { _tag: "ProjectFile", path },
} as const;

/** Stable string identity for a ref, used as a map/cache key. */
export function artifactRefKey(ref: ArtifactRef): string {
  switch (ref._tag) {
    case "Path":
      return `Path:${ref.path}`;
    case "Url":
      return `Url:${ref.url}`;
    case "Blob":
      return `Blob:${ref.id}`;
    case "GitBlob":
      return `GitBlob:${ref.repo}:${ref.oid}`;
    case "Project":
      return `Project:${ref.projectId ?? ""}`;
    case "ProjectFile":
      return `ProjectFile:${ref.projectId ?? ""}:${ref.path}`;
  }
}

export function pathFromArtifactRef(ref: ArtifactRef): string | null {
  switch (ref._tag) {
    case "Path":
    case "ProjectFile":
      return ref.path;
    case "Url":
      return pathnameFromUrl(ref.url);
    case "Blob":
    case "GitBlob":
    case "Project":
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
