import { Cost, type ArtifactCost } from "./policy";
import { pathFromArtifactRef, schemeFromArtifactRef, type ArtifactRef } from "./ref";

export interface ArtifactMetadata {
  readonly mimeType?: string | undefined;
  readonly mediaType?: string | undefined;
  readonly extension?: string | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly attributes?: Readonly<Record<string, unknown>> | undefined;
}

export interface ArtifactMatchInput {
  readonly ref: ArtifactRef;
  readonly metadata?: ArtifactMetadata | undefined;
}

export interface ArtifactMatcher {
  readonly _tag: "ArtifactMatcher";
  readonly name: string;
  readonly cost: ArtifactCost;
  readonly matches: (input: ArtifactMatchInput) => boolean;
}

export const ArtifactMatcher = {
  extension: (
    extension: string | readonly string[],
    options: MatcherOptions = {},
  ): ArtifactMatcher => {
    const extensions = normalizeExtensions(Array.isArray(extension) ? extension : [extension]);
    return makeMatcher({
      name: `extension:${extensions.join(",")}`,
      cost: options.cost ?? Cost.low,
      matches: ({ ref, metadata }) => {
        const metadataExtension = metadata?.extension
          ? normalizeExtension(metadata.extension)
          : null;
        const pathExtension = extensionFromPath(pathFromArtifactRef(ref));
        return extensions.some(
          (candidate) => candidate === metadataExtension || candidate === pathExtension,
        );
      },
    });
  },

  mime: (mimeType: string | readonly string[], options: MatcherOptions = {}): ArtifactMatcher => {
    const mimeTypes = normalizeMimeTypes(Array.isArray(mimeType) ? mimeType : [mimeType]);
    return makeMatcher({
      name: `mime:${mimeTypes.join(",")}`,
      cost: options.cost ?? Cost.low,
      matches: ({ metadata }) => {
        const actual = normalizeMimeType(metadata?.mimeType ?? metadata?.mediaType ?? null);
        return actual !== null && mimeTypes.includes(actual);
      },
    });
  },

  scheme: (scheme: string | readonly string[], options: MatcherOptions = {}): ArtifactMatcher => {
    const schemes = normalizeSchemes(Array.isArray(scheme) ? scheme : [scheme]);
    return makeMatcher({
      name: `scheme:${schemes.join(",")}`,
      cost: options.cost ?? Cost.low,
      matches: ({ ref }) => {
        const actual = schemeFromArtifactRef(ref);
        return actual !== null && schemes.includes(actual);
      },
    });
  },

  tag: (tag: string, options: MatcherOptions = {}): ArtifactMatcher =>
    makeMatcher({
      name: `tag:${tag}`,
      cost: options.cost ?? Cost.low,
      matches: ({ ref }) => ref._tag === tag,
    }),

  metadata: (key: string, expected?: unknown, options: MatcherOptions = {}): ArtifactMatcher =>
    makeMatcher({
      name: expected === undefined ? `metadata:${key}` : `metadata:${key}:${String(expected)}`,
      cost: options.cost ?? Cost.low,
      matches: ({ metadata }) => {
        if (!metadata?.attributes || !(key in metadata.attributes)) return false;
        return expected === undefined || Object.is(metadata.attributes[key], expected);
      },
    }),

  custom: (options: CustomMatcherOptions): ArtifactMatcher => makeMatcher(options),
} as const;

export interface MatcherOptions {
  readonly cost?: ArtifactCost | undefined;
}

export interface CustomMatcherOptions extends MatcherOptions {
  readonly name: string;
  readonly matches: (input: ArtifactMatchInput) => boolean;
}

function makeMatcher(options: CustomMatcherOptions): ArtifactMatcher {
  return {
    _tag: "ArtifactMatcher",
    name: options.name,
    cost: options.cost ?? Cost.low,
    matches: options.matches,
  };
}

function normalizeExtensions(extensions: readonly string[]): readonly string[] {
  return extensions.map(normalizeExtension);
}

function normalizeExtension(extension: string): string {
  return extension.replace(/^\./, "").toLowerCase();
}

function extensionFromPath(path: string | null): string | null {
  if (!path) return null;
  const fileName = path.split(/[\\/]/).pop() ?? path;
  const index = fileName.lastIndexOf(".");
  if (index < 0 || index === fileName.length - 1) return null;
  return normalizeExtension(fileName.slice(index + 1));
}

function normalizeMimeTypes(mimeTypes: readonly string[]): readonly string[] {
  return mimeTypes.map(normalizeMimeType).filter((mimeType) => mimeType !== null);
}

function normalizeMimeType(mimeType: string | null): string | null {
  const normalized = mimeType?.trim().toLowerCase();
  return normalized && normalized.length > 0 ? normalized : null;
}

function normalizeSchemes(schemes: readonly string[]): readonly string[] {
  return schemes.map((scheme) => scheme.replace(/:$/, "").toLowerCase());
}
