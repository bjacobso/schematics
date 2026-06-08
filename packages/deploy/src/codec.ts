import { type ConfigCodec } from "@schematics/alchemy";
import { parseYaml, stringifyDocument } from "@schematics/core";
import { Result, Schema } from "effect";

/**
 * A YAML {@link ConfigCodec} built on the Schematics document codec, so files
 * written by the deploy engine match the rest of a Schematics project. Shared
 * by every example's config-as-code wiring — there's nothing domain-specific
 * about turning YAML text into a value and back.
 */
export const yamlConfigCodec: ConfigCodec = {
  extension: "yaml",
  parse: (text) => {
    const result = Schema.decodeUnknownResult(parseYaml())(text);
    if (Result.isFailure(result)) throw new Error("Failed to parse YAML document");
    return result.success;
  },
  stringify: (value) => stringifyDocument(value, "yaml"),
};

/** Turn a human name into a filesystem-friendly slug used to key config files. */
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "item";
}
