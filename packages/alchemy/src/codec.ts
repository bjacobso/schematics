/**
 * A codec turns the canonical "wire" value (the schema's encoded form — a plain
 * JSON-shaped object) into file text and back. The engine stays format-agnostic;
 * the abstract layer ships a JSON codec for tests, and Layer 2 (the catalog example) plugs
 * in a YAML codec so files round-trip as `*.yaml`.
 *
 * `parse` and `stringify` may throw — the engine wraps them and surfaces a
 * {@link ConfigCodecError} with the offending file path.
 */
export interface ConfigCodec {
  /** File extension this codec produces, without the dot (e.g. "json", "yaml"). */
  readonly extension: string;
  readonly parse: (text: string) => unknown;
  readonly stringify: (value: unknown) => string;
}

/** Built-in JSON codec. Pretty-printed, trailing newline, stable enough for fixtures. */
export const jsonCodec: ConfigCodec = {
  extension: "json",
  parse: (text) => JSON.parse(text),
  stringify: (value) => `${JSON.stringify(value, null, 2)}\n`,
};
