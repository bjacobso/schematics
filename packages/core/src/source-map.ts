import type {
  DocumentSourceMap,
  SchematicsDocumentFormat,
  SourcePosition,
  SourceRange,
} from "./types";

export interface SourceMapBuilder {
  readonly add: (path: readonly PropertyKey[], startOffset: number, endOffset: number) => void;
  readonly build: () => DocumentSourceMap;
  readonly positionAt: (offset: number) => SourcePosition;
}

export function createDocumentSourceMapBuilder({
  text,
  filePath,
  format,
}: {
  readonly text: string;
  readonly filePath: string | null;
  readonly format: SchematicsDocumentFormat;
}): SourceMapBuilder {
  const lineStarts = lineStartOffsets(text);
  const ranges = new Map<string, SourceRange>();

  const positionAt = (offset: number): SourcePosition => {
    const normalizedOffset = Math.max(0, Math.min(offset, text.length));
    let low = 0;
    let high = lineStarts.length - 1;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const lineStart = lineStarts[middle] ?? 0;
      if (lineStart <= normalizedOffset) {
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    const lineIndex = Math.max(0, high);
    const lineStart = lineStarts[lineIndex] ?? 0;
    return {
      line: lineIndex + 1,
      column: normalizedOffset - lineStart + 1,
      offset: normalizedOffset,
    };
  };

  return {
    add: (path, startOffset, endOffset) => {
      const normalizedPath = normalizeDocumentPath(path);
      const start = Math.max(0, Math.min(startOffset, text.length));
      const end = Math.max(start, Math.min(endOffset, text.length));
      ranges.set(pathKey(normalizedPath), {
        path: formatDocumentPath(normalizedPath),
        start: positionAt(start),
        end: positionAt(end),
      });
    },
    build: () => ({
      filePath,
      format,
      locate: (documentPath) => ranges.get(pathKey(normalizeDocumentPath(documentPath))) ?? null,
      locateStringPath: (documentPath) =>
        ranges.get(pathKey(parseDocumentPath(documentPath))) ?? null,
    }),
    positionAt,
  };
}

export function normalizeDocumentPath(path: readonly PropertyKey[]): readonly PropertyKey[] {
  return path.map((segment) =>
    typeof segment === "string" && /^\d+$/.test(segment) ? Number.parseInt(segment, 10) : segment,
  );
}

export function parseDocumentPath(path: string): readonly PropertyKey[] {
  return normalizeDocumentPath(path.split(".").filter(Boolean));
}

export function formatDocumentPath(path: readonly PropertyKey[]): string {
  return normalizeDocumentPath(path)
    .map((segment) => String(segment))
    .join(".");
}

export function locateNearestSourceRange(
  sourceMap: DocumentSourceMap,
  path: readonly PropertyKey[],
): SourceRange | null {
  const normalizedPath = normalizeDocumentPath(path);
  for (let index = normalizedPath.length; index >= 0; index -= 1) {
    const range = sourceMap.locate(normalizedPath.slice(0, index));
    if (range) return range;
  }
  return null;
}

function pathKey(path: readonly PropertyKey[]): string {
  return JSON.stringify(normalizeDocumentPath(path).map((segment) => String(segment)));
}

function lineStartOffsets(text: string): readonly number[] {
  const offsets = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n") {
      offsets.push(index + 1);
    }
  }
  return offsets;
}
