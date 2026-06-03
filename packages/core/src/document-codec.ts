import { Result, Schema, SchemaGetter, SchemaIssue } from "effect";
import YAML from "yaml";
import type {
  SchematicsDiagnostic,
  SchematicsDocumentCodec,
  SchematicsDocumentFormat,
  SchematicsParseResult,
} from "./types";

export const JsonDocumentCodec: SchematicsDocumentCodec = {
  format: "json",
  extensions: [".json"],
  parse: (text, path) => {
    try {
      return { success: true, value: JSON.parse(text) };
    } catch (error) {
      return {
        success: false,
        diagnostic: parseDiagnostic({
          path: path ?? null,
          source: "json-parse",
          message: error instanceof Error ? error.message : "Invalid JSON",
          position: jsonErrorPosition(text, error),
        }),
      };
    }
  },
  stringify: (value) => `${JSON.stringify(value, null, 2)}\n`,
};

export const YamlDocumentCodec: SchematicsDocumentCodec = {
  format: "yaml",
  extensions: [".yaml", ".yml"],
  parse: (text, path) => {
    const document = YAML.parseDocument(text, { prettyErrors: false });
    const error = document.errors[0];

    if (error) {
      const linePos = error.linePos?.[0];
      return {
        success: false,
        diagnostic: parseDiagnostic({
          path: path ?? null,
          source: "yaml-parse",
          message: error.message,
          position: linePos ? { line: linePos.line, column: linePos.col } : undefined,
        }),
      };
    }

    try {
      return { success: true, value: document.toJSON() };
    } catch (error_) {
      return {
        success: false,
        diagnostic: parseDiagnostic({
          path: path ?? null,
          source: "yaml-parse",
          message: error_ instanceof Error ? error_.message : "Invalid YAML",
        }),
      };
    }
  },
  stringify: (value) => YAML.stringify(value),
};

export const BuiltInDocumentCodecs = [JsonDocumentCodec, YamlDocumentCodec] as const;

export function codecForFormat(format: SchematicsDocumentFormat): SchematicsDocumentCodec {
  return format === "yaml" ? YamlDocumentCodec : JsonDocumentCodec;
}

export function codecForPath(
  path: string,
  fallbackFormat: SchematicsDocumentFormat = "json",
): SchematicsDocumentCodec {
  const lower = path.toLowerCase();
  return (
    BuiltInDocumentCodecs.find((codec) =>
      codec.extensions.some((extension) => lower.endsWith(extension)),
    ) ?? codecForFormat(fallbackFormat)
  );
}

export function formatForPath(
  path: string,
  fallbackFormat: SchematicsDocumentFormat = "json",
): SchematicsDocumentFormat {
  return codecForPath(path, fallbackFormat).format;
}

export function parseDocument(
  text: string,
  format: SchematicsDocumentFormat,
  path?: string | null,
): SchematicsParseResult<unknown> {
  return codecForFormat(format).parse(text, path);
}

export function stringifyDocument(value: unknown, format: SchematicsDocumentFormat): string {
  return codecForFormat(format).stringify(value);
}

export const parseYaml: {
  <A>(schema: Schema.Schema<A>): Schema.Codec<A, string>;
  (): Schema.Codec<unknown, string>;
} = <A>(schema?: Schema.Schema<A>) => {
  const target = schema ?? Schema.Unknown;
  return Schema.String.pipe(
    Schema.decodeTo(target, {
      decode: SchemaGetter.transform((input: string) => YAML.parse(input)),
      encode: SchemaGetter.transform((value: unknown) => YAML.stringify(value)),
    }),
  ) as never;
};

export function decodeYamlEither<A>(
  schema: Schema.Schema<A>,
  text: string,
): Result.Result<A, SchemaIssue.Issue> {
  return Schema.decodeUnknownResult(parseYaml(schema) as never)(text) as Result.Result<
    A,
    SchemaIssue.Issue
  >;
}

function parseDiagnostic({
  path,
  source,
  message,
  position,
}: {
  readonly path?: string | null | undefined;
  readonly source: "json-parse" | "yaml-parse";
  readonly message: string;
  readonly position?: { readonly line: number; readonly column: number } | undefined;
}): SchematicsDiagnostic {
  return {
    path: path ?? null,
    severity: "error",
    message,
    source,
    ...(position ? { line: position.line, column: position.column } : {}),
  };
}

function jsonErrorPosition(
  text: string,
  error: unknown,
): { readonly line: number; readonly column: number } | undefined {
  if (!(error instanceof SyntaxError)) return undefined;
  const match = error.message.match(/position (\d+)/);
  if (!match?.[1]) return undefined;

  const position = Number.parseInt(match[1], 10);
  if (!Number.isFinite(position)) return undefined;

  const prefix = text.slice(0, position);
  const lines = prefix.split(/\r?\n/);
  return {
    line: lines.length,
    column: (lines.at(-1)?.length ?? 0) + 1,
  };
}
