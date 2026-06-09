import { Result, Schema, SchemaGetter, SchemaIssue } from "effect";
import YAML from "yaml";
import type {
  DocumentSourceMap,
  ParsedDocument,
  SchematicsDiagnostic,
  SchematicsDocumentCodec,
  SchematicsDocumentFormat,
  SchematicsParseResult,
} from "./types";
import { createDocumentSourceMapBuilder } from "./source-map";

export const JsonDocumentCodec: SchematicsDocumentCodec = {
  format: "json",
  extensions: [".json"],
  parse: (text, path) => {
    try {
      return parseJsonDocument(text, path ?? null);
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
      const value = document.toJSON();
      return parsedDocument(value, buildYamlSourceMap(text, path ?? null, document));
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

  const explicitPosition =
    "position" in error && typeof error.position === "number" ? error.position : undefined;
  const match = explicitPosition === undefined ? error.message.match(/position (\d+)/) : undefined;
  const position = explicitPosition ?? (match?.[1] ? Number.parseInt(match[1], 10) : Number.NaN);
  if (!Number.isFinite(position)) return undefined;

  const prefix = text.slice(0, position);
  const lines = prefix.split(/\r?\n/);
  return {
    line: lines.length,
    column: (lines.at(-1)?.length ?? 0) + 1,
  };
}

function parsedDocument<A>(value: A, sourceMap: DocumentSourceMap): SchematicsParseResult<A> {
  return {
    success: true,
    value,
    document: { value, sourceMap },
  };
}

function parseJsonDocument(text: string, path: string | null): SchematicsParseResult<unknown> {
  const parser = new JsonSourceParser(text, path);
  const document = parser.parse();
  return parsedDocument(document.value, document.sourceMap);
}

class JsonParseError extends SyntaxError {
  readonly position: number;

  constructor(message: string, position: number) {
    super(`${message} at position ${position}`);
    this.position = position;
  }
}

class JsonSourceParser {
  private readonly sourceMapBuilder: ReturnType<typeof createDocumentSourceMapBuilder>;
  private offset = 0;

  constructor(
    private readonly text: string,
    path: string | null,
  ) {
    this.sourceMapBuilder = createDocumentSourceMapBuilder({
      text,
      filePath: path,
      format: "json",
    });
  }

  parse(): ParsedDocument<unknown> {
    this.skipWhitespace();
    const value = this.parseValue([]);
    this.skipWhitespace();
    if (this.offset !== this.text.length) {
      throw new JsonParseError("Unexpected token", this.offset);
    }
    return { value, sourceMap: this.sourceMapBuilder.build() };
  }

  private parseValue(path: readonly PropertyKey[]): unknown {
    this.skipWhitespace();
    const start = this.offset;
    const char = this.peek();

    if (char === "{") {
      const value = this.parseObject(path);
      this.sourceMapBuilder.add(path, start, this.offset);
      return value;
    }
    if (char === "[") {
      const value = this.parseArray(path);
      this.sourceMapBuilder.add(path, start, this.offset);
      return value;
    }
    if (char === '"') {
      const value = this.parseString();
      this.sourceMapBuilder.add(path, start, this.offset);
      return value;
    }
    if (char === "-" || isDigit(char)) {
      const value = this.parseNumber();
      this.sourceMapBuilder.add(path, start, this.offset);
      return value;
    }
    if (this.consumeLiteral("true")) {
      this.sourceMapBuilder.add(path, start, this.offset);
      return true;
    }
    if (this.consumeLiteral("false")) {
      this.sourceMapBuilder.add(path, start, this.offset);
      return false;
    }
    if (this.consumeLiteral("null")) {
      this.sourceMapBuilder.add(path, start, this.offset);
      return null;
    }

    throw new JsonParseError("Unexpected token", this.offset);
  }

  private parseObject(path: readonly PropertyKey[]): Record<string, unknown> {
    this.expect("{");
    const value: Record<string, unknown> = {};
    this.skipWhitespace();
    if (this.peek() === "}") {
      this.offset += 1;
      return value;
    }

    while (this.offset < this.text.length) {
      this.skipWhitespace();
      if (this.peek() !== '"') throw new JsonParseError("Expected property name", this.offset);
      const key = this.parseString();
      this.skipWhitespace();
      this.expect(":");
      value[key] = this.parseValue([...path, key]);
      this.skipWhitespace();
      const char = this.peek();
      if (char === "}") {
        this.offset += 1;
        return value;
      }
      if (char !== ",") throw new JsonParseError("Expected ',' or '}'", this.offset);
      this.offset += 1;
    }

    throw new JsonParseError("Unterminated object", this.offset);
  }

  private parseArray(path: readonly PropertyKey[]): readonly unknown[] {
    this.expect("[");
    const value: unknown[] = [];
    this.skipWhitespace();
    if (this.peek() === "]") {
      this.offset += 1;
      return value;
    }

    while (this.offset < this.text.length) {
      const index = value.length;
      value.push(this.parseValue([...path, index]));
      this.skipWhitespace();
      const char = this.peek();
      if (char === "]") {
        this.offset += 1;
        return value;
      }
      if (char !== ",") throw new JsonParseError("Expected ',' or ']'", this.offset);
      this.offset += 1;
    }

    throw new JsonParseError("Unterminated array", this.offset);
  }

  private parseString(): string {
    this.expect('"');
    let value = "";

    while (this.offset < this.text.length) {
      const char = this.text[this.offset];
      if (char === '"') {
        this.offset += 1;
        return value;
      }
      if (char === "\\") {
        value += this.parseEscape();
        continue;
      }
      if (!char || char < " ") {
        throw new JsonParseError("Invalid control character", this.offset);
      }
      value += char;
      this.offset += 1;
    }

    throw new JsonParseError("Unterminated string", this.offset);
  }

  private parseEscape(): string {
    this.offset += 1;
    const char = this.text[this.offset];
    if (!char) throw new JsonParseError("Unterminated escape sequence", this.offset);
    this.offset += 1;

    switch (char) {
      case '"':
      case "\\":
      case "/":
        return char;
      case "b":
        return "\b";
      case "f":
        return "\f";
      case "n":
        return "\n";
      case "r":
        return "\r";
      case "t":
        return "\t";
      case "u": {
        const hex = this.text.slice(this.offset, this.offset + 4);
        if (!/^[\da-fA-F]{4}$/.test(hex)) {
          throw new JsonParseError("Invalid unicode escape", this.offset);
        }
        this.offset += 4;
        return String.fromCharCode(Number.parseInt(hex, 16));
      }
      default:
        throw new JsonParseError("Invalid escape character", this.offset - 1);
    }
  }

  private parseNumber(): number {
    const start = this.offset;
    if (this.peek() === "-") this.offset += 1;

    if (this.peek() === "0") {
      this.offset += 1;
    } else if (isNonZeroDigit(this.peek())) {
      while (isDigit(this.peek())) this.offset += 1;
    } else {
      throw new JsonParseError("Invalid number", this.offset);
    }

    if (this.peek() === ".") {
      this.offset += 1;
      if (!isDigit(this.peek())) throw new JsonParseError("Invalid number", this.offset);
      while (isDigit(this.peek())) this.offset += 1;
    }

    if (this.peek() === "e" || this.peek() === "E") {
      this.offset += 1;
      if (this.peek() === "+" || this.peek() === "-") this.offset += 1;
      if (!isDigit(this.peek())) throw new JsonParseError("Invalid number", this.offset);
      while (isDigit(this.peek())) this.offset += 1;
    }

    const value = Number(this.text.slice(start, this.offset));
    if (!Number.isFinite(value)) throw new JsonParseError("Invalid number", start);
    return value;
  }

  private consumeLiteral(literal: string): boolean {
    if (!this.text.startsWith(literal, this.offset)) return false;
    this.offset += literal.length;
    return true;
  }

  private skipWhitespace(): void {
    while (/[\t\n\r ]/.test(this.peek())) {
      this.offset += 1;
    }
  }

  private expect(expected: string): void {
    if (this.peek() !== expected) {
      throw new JsonParseError(`Expected '${expected}'`, this.offset);
    }
    this.offset += 1;
  }

  private peek(): string {
    return this.text[this.offset] ?? "";
  }
}

function buildYamlSourceMap(
  text: string,
  path: string | null,
  document: ReturnType<typeof YAML.parseDocument>,
): DocumentSourceMap {
  const builder = createDocumentSourceMapBuilder({ text, filePath: path, format: "yaml" });
  walkYamlNode(document.contents, [], builder);
  if (!builder.build().locate([])) {
    builder.add([], 0, text.length);
  }
  return builder.build();
}

function walkYamlNode(
  node: unknown,
  path: readonly PropertyKey[],
  builder: ReturnType<typeof createDocumentSourceMapBuilder>,
): void {
  if (!isYamlNode(node)) return;

  const range = yamlNodeRange(node);
  if (range) {
    builder.add(path, range.start, range.end);
  }

  if (!Array.isArray(node.items)) return;

  if (node.items.every(isYamlPair)) {
    for (const pair of node.items) {
      const key = yamlScalarValue(pair.key);
      if (typeof key === "string" || typeof key === "number") {
        walkYamlNode(pair.value, [...path, key], builder);
      }
    }
    return;
  }

  node.items.forEach((item, index) => {
    walkYamlNode(item, [...path, index], builder);
  });
}

function yamlNodeRange(node: YamlNode): { readonly start: number; readonly end: number } | null {
  const range = node.range;
  if (!Array.isArray(range) || typeof range[0] !== "number") return null;
  return {
    start: range[0],
    end:
      typeof range[2] === "number" ? range[2] : typeof range[1] === "number" ? range[1] : range[0],
  };
}

function yamlScalarValue(node: unknown): unknown {
  if (node && typeof node === "object" && "value" in node) {
    return node.value;
  }
  return undefined;
}

interface YamlNode {
  readonly range?: readonly number[] | undefined;
  readonly items?: readonly unknown[] | undefined;
}

interface YamlPair {
  readonly key: unknown;
  readonly value: unknown;
}

function isYamlNode(value: unknown): value is YamlNode {
  return Boolean(value && typeof value === "object");
}

function isYamlPair(value: unknown): value is YamlPair {
  return Boolean(value && typeof value === "object" && "key" in value && "value" in value);
}

function isDigit(value: string): boolean {
  return value >= "0" && value <= "9";
}

function isNonZeroDigit(value: string): boolean {
  return value >= "1" && value <= "9";
}
