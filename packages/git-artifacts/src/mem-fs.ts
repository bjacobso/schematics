/**
 * A tiny POSIX-ish in-memory filesystem that satisfies the subset of the Node
 * `fs.promises` API that isomorphic-git uses (read/write/unlink/readdir/mkdir/
 * rmdir/stat/lstat/symlink/readlink).
 *
 * It is deliberately dependency-free and runtime-agnostic so the exact same
 * `GitRepoBackend` runs inside a Cloudflare Worker (no `node:fs`) and in tests —
 * the "isomorphic" half of isomorphic-git. For local CLI use against a real
 * checkout, swap this for Node's `fs` (see `node.ts`).
 */

const ENC = new TextEncoder();
const DEC = new TextDecoder();

type FsErrorCode = "ENOENT" | "EEXIST" | "ENOTDIR" | "EISDIR" | "ENOTEMPTY";

class FsError extends Error {
  constructor(
    readonly code: FsErrorCode,
    syscall: string,
    path: string,
  ) {
    super(`${code}: ${syscall} '${path}'`);
    this.name = "FsError";
  }
}

interface MemNode {
  readonly type: "file" | "dir" | "symlink";
  content: Uint8Array; // file bytes, or symlink target (utf8)
  mode: number;
  mtimeMs: number;
  readonly ino: number;
}

interface MemStats {
  readonly type: "file" | "dir" | "symlink";
  readonly mode: number;
  readonly size: number;
  readonly ino: number;
  readonly mtimeMs: number;
  readonly ctimeMs: number;
  readonly uid: number;
  readonly gid: number;
  readonly dev: number;
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}

interface ReadFileOptions {
  readonly encoding?: string | undefined;
}

interface WriteFileOptions {
  readonly encoding?: string | undefined;
  readonly mode?: number | undefined;
}

/** The promise-based surface isomorphic-git consumes via `fs.promises`. */
export interface MemFsPromises {
  readFile(path: string, options?: ReadFileOptions | string): Promise<Uint8Array | string>;
  writeFile(
    path: string,
    data: Uint8Array | string,
    options?: WriteFileOptions | string,
  ): Promise<void>;
  unlink(path: string): Promise<void>;
  readdir(path: string): Promise<string[]>;
  mkdir(path: string, options?: { recursive?: boolean | undefined }): Promise<void>;
  rmdir(path: string): Promise<void>;
  stat(path: string): Promise<MemStats>;
  lstat(path: string): Promise<MemStats>;
  readlink(path: string): Promise<string>;
  symlink(target: string, path: string): Promise<void>;
  chmod(path: string, mode: number): Promise<void>;
}

export interface MemFs {
  readonly promises: MemFsPromises;
  /** Snapshot of every file path → bytes (dirs/symlinks excluded). Test helper. */
  snapshot(): Map<string, Uint8Array>;
}

function normalize(path: string): string {
  const segments: string[] = [];
  for (const raw of path.split("/")) {
    if (raw === "" || raw === ".") continue;
    if (raw === "..") {
      segments.pop();
      continue;
    }
    segments.push(raw);
  }
  return `/${segments.join("/")}`;
}

function dirname(path: string): string {
  const normalized = normalize(path);
  const index = normalized.lastIndexOf("/");
  return index <= 0 ? "/" : normalized.slice(0, index);
}

function basename(path: string): string {
  const normalized = normalize(path);
  return normalized.slice(normalized.lastIndexOf("/") + 1);
}

export function createMemFs(): MemFs {
  const nodes = new Map<string, MemNode>();
  let nextIno = 1;
  let clock = 1;

  // Root always exists.
  nodes.set("/", { type: "dir", content: new Uint8Array(), mode: 0o040755, mtimeMs: 0, ino: 0 });

  const now = () => clock++;

  const get = (path: string): MemNode | undefined => nodes.get(normalize(path));

  const requireParentDir = (path: string, syscall: string): void => {
    const parent = nodes.get(dirname(path));
    if (!parent) throw new FsError("ENOENT", syscall, path);
    if (parent.type !== "dir") throw new FsError("ENOTDIR", syscall, path);
  };

  const toStats = (node: MemNode): MemStats => ({
    type: node.type,
    mode: node.mode,
    size: node.content.length,
    ino: node.ino,
    mtimeMs: node.mtimeMs,
    ctimeMs: node.mtimeMs,
    uid: 1,
    gid: 1,
    dev: 1,
    isFile: () => node.type === "file",
    isDirectory: () => node.type === "dir",
    isSymbolicLink: () => node.type === "symlink",
  });

  const mkdirOne = (path: string, allowExisting: boolean): void => {
    const key = normalize(path);
    if (key === "/") return;
    const existing = nodes.get(key);
    if (existing) {
      if (existing.type === "dir" && allowExisting) return;
      throw new FsError("EEXIST", "mkdir", path);
    }
    requireParentDir(key, "mkdir");
    nodes.set(key, {
      type: "dir",
      content: new Uint8Array(),
      mode: 0o040755,
      mtimeMs: now(),
      ino: nextIno++,
    });
  };

  const promises: MemFsPromises = {
    readFile: (path, options) =>
      Promise.resolve().then(() => {
        const node = get(path);
        if (!node) throw new FsError("ENOENT", "read", path);
        if (node.type === "dir") throw new FsError("EISDIR", "read", path);
        const encoding = typeof options === "string" ? options : options?.encoding;
        return encoding ? DEC.decode(node.content) : node.content.slice();
      }),

    writeFile: (path, data, options) =>
      Promise.resolve().then(() => {
        const key = normalize(path);
        requireParentDir(key, "open");
        const existing = nodes.get(key);
        if (existing?.type === "dir") throw new FsError("EISDIR", "open", path);
        const bytes = typeof data === "string" ? ENC.encode(data) : data.slice();
        const mode = (typeof options === "object" ? options?.mode : undefined) ?? 0o100644;
        nodes.set(key, {
          type: "file",
          content: bytes,
          mode,
          mtimeMs: now(),
          ino: existing?.ino ?? nextIno++,
        });
      }),

    unlink: (path) =>
      Promise.resolve().then(() => {
        const key = normalize(path);
        const node = nodes.get(key);
        if (!node) throw new FsError("ENOENT", "unlink", path);
        if (node.type === "dir") throw new FsError("EISDIR", "unlink", path);
        nodes.delete(key);
      }),

    readdir: (path) =>
      Promise.resolve().then(() => {
        const key = normalize(path);
        const node = nodes.get(key);
        if (!node) throw new FsError("ENOENT", "scandir", path);
        if (node.type !== "dir") throw new FsError("ENOTDIR", "scandir", path);
        const prefix = key === "/" ? "/" : `${key}/`;
        const names = new Set<string>();
        for (const candidate of nodes.keys()) {
          if (candidate === key || !candidate.startsWith(prefix)) continue;
          const rest = candidate.slice(prefix.length);
          const slash = rest.indexOf("/");
          names.add(slash === -1 ? rest : rest.slice(0, slash));
        }
        return [...names].sort();
      }),

    mkdir: (path, options) =>
      Promise.resolve().then(() => {
        if (options?.recursive) {
          const key = normalize(path);
          const segments = key.split("/").filter(Boolean);
          let current = "";
          for (const segment of segments) {
            current += `/${segment}`;
            mkdirOne(current, true);
          }
          return;
        }
        mkdirOne(path, false);
      }),

    rmdir: (path) =>
      Promise.resolve().then(() => {
        const key = normalize(path);
        const node = nodes.get(key);
        if (!node) throw new FsError("ENOENT", "rmdir", path);
        if (node.type !== "dir") throw new FsError("ENOTDIR", "rmdir", path);
        const prefix = `${key}/`;
        for (const candidate of nodes.keys()) {
          if (candidate.startsWith(prefix)) throw new FsError("ENOTEMPTY", "rmdir", path);
        }
        nodes.delete(key);
      }),

    stat: (path) =>
      Promise.resolve().then(() => {
        const node = get(path);
        if (!node) throw new FsError("ENOENT", "stat", path);
        return toStats(node);
      }),

    lstat: (path) =>
      Promise.resolve().then(() => {
        const node = get(path);
        if (!node) throw new FsError("ENOENT", "lstat", path);
        return toStats(node);
      }),

    readlink: (path) =>
      Promise.resolve().then(() => {
        const node = get(path);
        if (!node) throw new FsError("ENOENT", "readlink", path);
        if (node.type !== "symlink") throw new FsError("ENOENT", "readlink", path);
        return DEC.decode(node.content);
      }),

    symlink: (target, path) =>
      Promise.resolve().then(() => {
        const key = normalize(path);
        requireParentDir(key, "symlink");
        if (nodes.has(key)) throw new FsError("EEXIST", "symlink", path);
        nodes.set(key, {
          type: "symlink",
          content: ENC.encode(target),
          mode: 0o120000,
          mtimeMs: now(),
          ino: nextIno++,
        });
      }),

    chmod: (path, mode) =>
      Promise.resolve().then(() => {
        const node = get(path);
        if (!node) throw new FsError("ENOENT", "chmod", path);
        node.mode = mode;
      }),
  };

  return {
    promises,
    snapshot: () => {
      const result = new Map<string, Uint8Array>();
      for (const [key, node] of nodes) {
        if (node.type === "file") result.set(key, node.content.slice());
      }
      return result;
    },
  };
}

export { basename as memFsBasename, dirname as memFsDirname, normalize as memFsNormalize };
