import { codecForPath } from "@schematics/core";
import { Effect } from "effect";
import { Tool, Toolkit } from "effect/unstable/ai";
import { ToolFailure } from "./common-toolkit-schemas";
import {
  JsonPatchParameters,
  JsonPatchSuccess,
  type JsonPatchOperationInput,
} from "./json-schemas";
import { SchematicsWorkspace, toToolFailure, toolFailure } from "./schematics-workspace";

export const JsonPatchTool = Tool.make("json_patch", {
  description: "Apply JSON Patch operations to a JSON or YAML file.",
  parameters: JsonPatchParameters,
  success: JsonPatchSuccess,
  failure: ToolFailure,
  failureMode: "return",
});

export const JsonToolkit = Toolkit.make(JsonPatchTool);

export const JsonToolkitLayer = JsonToolkit.toLayer(
  Effect.gen(function* () {
    const workspace = yield* SchematicsWorkspace;
    return JsonToolkit.of({
      json_patch: Effect.fn("JsonToolkit.json_patch")(function* ({ path, patch, validate }) {
        const file = yield* workspace.readFile(path);

        const codec = documentCodecForPatchPath(path);
        if (!codec) {
          return yield* Effect.fail(toolFailure(`Unsupported patch file extension: ${path}`));
        }

        const parsed = codec.parse(file.content, path);
        if (!parsed.success) return yield* Effect.fail(toolFailure(parsed.diagnostic.message));

        const value = yield* applyJsonPatchValue(parsed.value, patch);
        const content = codec.stringify(value);
        const result = yield* workspace.applyEdits([{ path, content }], { validate });
        return { success: true, path, value, validation: result.validation };
      }),
    });
  }),
);

function documentCodecForPatchPath(path: string) {
  if (!/\.(json|ya?ml)$/i.test(path)) return null;
  return codecForPath(path);
}

function applyJsonPatchValue(input: unknown, patch: readonly JsonPatchOperationInput[]) {
  return Effect.try({
    try: () => applyJsonPatch(input, patch),
    catch: toToolFailure,
  });
}

function applyJsonPatch(input: unknown, patch: readonly JsonPatchOperationInput[]): unknown {
  let document = structuredCloneFallback(input);
  for (const operation of patch) {
    if ((operation.op === "add" || operation.op === "replace") && !("value" in operation)) {
      throw new Error(`Patch operation ${operation.op} at ${operation.path} requires value.`);
    }
    document = applyJsonPatchOperation(document, operation);
  }
  return document;
}

function applyJsonPatchOperation(document: unknown, operation: JsonPatchOperationInput): unknown {
  const tokens = parseJsonPointer(operation.path);
  if (!tokens.length) {
    if (operation.op === "remove") return undefined;
    return structuredCloneFallback(operation.value);
  }

  const parent = getJsonPointerParent(document, tokens);
  const key = tokens[tokens.length - 1]!;
  if (Array.isArray(parent)) {
    applyArrayPatch(parent, key, operation);
    return document;
  }
  if (!isRecord(parent)) {
    throw new Error(`Patch path parent is not an object or array: ${operation.path}`);
  }

  if (operation.op === "remove") {
    if (!Object.hasOwn(parent, key))
      throw new Error(`Patch path does not exist: ${operation.path}`);
    delete parent[key];
    return document;
  }
  if (operation.op === "replace" && !Object.hasOwn(parent, key)) {
    throw new Error(`Patch path does not exist: ${operation.path}`);
  }
  parent[key] = structuredCloneFallback(operation.value);
  return document;
}

function parseJsonPointer(path: string): readonly string[] {
  if (path === "") return [];
  if (!path.startsWith("/")) throw new Error(`Invalid JSON Pointer path: ${path}`);
  return path
    .slice(1)
    .split("/")
    .map((token) => token.replace(/~1/g, "/").replace(/~0/g, "~"));
}

function getJsonPointerParent(document: unknown, tokens: readonly string[]): unknown {
  let current = document;
  for (const token of tokens.slice(0, -1)) {
    if (Array.isArray(current)) {
      const index = parseArrayIndex(token, current.length, false);
      current = current[index];
    } else if (isRecord(current)) {
      if (!Object.hasOwn(current, token)) {
        throw new Error(`Patch path does not exist: /${tokens.join("/")}`);
      }
      current = current[token];
    } else {
      throw new Error(`Patch path parent is not an object or array: /${tokens.join("/")}`);
    }
  }
  return current;
}

function applyArrayPatch(target: unknown[], key: string, operation: JsonPatchOperationInput) {
  if (operation.op === "add") {
    const index = key === "-" ? target.length : parseArrayIndex(key, target.length, true);
    target.splice(index, 0, structuredCloneFallback(operation.value));
    return;
  }

  const index = parseArrayIndex(key, target.length, false);
  if (operation.op === "remove") {
    target.splice(index, 1);
    return;
  }
  target[index] = structuredCloneFallback(operation.value);
}

function parseArrayIndex(token: string, length: number, allowEnd: boolean): number {
  if (!/^(0|[1-9]\d*)$/.test(token)) throw new Error(`Invalid array index: ${token}`);
  const index = Number.parseInt(token, 10);
  const max = allowEnd ? length : length - 1;
  if (index < 0 || index > max) throw new Error(`Array index out of bounds: ${token}`);
  return index;
}

function structuredCloneFallback(value: unknown): unknown {
  if (typeof structuredClone === "function") return structuredClone(value);
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
