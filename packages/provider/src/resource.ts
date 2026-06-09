import type { AnyArtifactType } from "@schematics/artifacts";
import type { Effect, Schema } from "effect";

/** How config-as-code may mutate a resource against the remote system. */
export type ResourceWriteOps = "full" | "create-only" | "deprecate" | "read-only";

/** The per-resource CRUD segment a provider's transport exposes (live or mock). */
export interface ResourceCrud<Dto> {
  readonly list: Effect.Effect<readonly Dto[], any>;
  readonly get: (id: string) => Effect.Effect<Dto | null, any>;
  readonly create: (record: Dto) => Effect.Effect<Dto, any>;
  readonly update: (id: string, record: Dto) => Effect.Effect<Dto, any>;
  readonly delete: (id: string) => Effect.Effect<void, any>;
}

/**
 * Everything about one resource, co-located. The schema-side fields drive the
 * artifact project, workspace schema, and validation (Phase 1); the deploy-side
 * fields drive the reconciler and mock (Phases 2–3). `schema` carries the
 * Relation algebra annotations — the DSL collects it, it does not generate it.
 */
export interface ResourceDefinition<C = any, Dto = any, Api = any> {
  /** Algebra relation kind embedded in the schema's `Relation.id` (e.g. "branch"). */
  readonly kind: string;
  /** Artifact-project route id / schema id (e.g. "Branches"). */
  readonly schemaId: string;
  /** The config-file schema for one instance. */
  readonly schema: Schema.Schema<C>;
  /** A single container file vs an array of files. Default `false` (array). */
  readonly single?: boolean | undefined;
  /** Document format. Default `"yaml"`. */
  readonly format?: "yaml" | "json" | undefined;
  /** Workspace-struct field. Default: `schemaId` with a lowercased first char. */
  readonly workspaceField?: string | undefined;
  /** File glob. Default: `single ? "<field>.<fmt>" : "<field>/*.<fmt>"`. */
  readonly route?: string | undefined;
  readonly description?: string | undefined;
  /** Artifact type for routes. Default `SchematicsProjectFileArtifact`. */
  readonly artifactType?: AnyArtifactType | undefined;

  // ── deploy-side (Phases 2–3) ──────────────────────────────────────────────
  /** Identity field holding the slug. Default `"id"`. */
  readonly key?: string | undefined;
  /** Segment key in the provider's transport. Default: `workspaceField`. */
  readonly remoteKey?: string | undefined;
  /** Identity field on the wire DTO (keys the derived mock). Default: `key`. */
  readonly dtoKey?: string | undefined;
  /** Stable slug for filenames; default derives from `key`. */
  readonly slug?: ((config: C) => string) | undefined;
  /** wire → config. */
  readonly decode?: ((dto: Dto) => C) | undefined;
  /** config → wire, for create and update. */
  readonly encode?:
    | { readonly create?: (config: C) => unknown; readonly update?: (config: C) => unknown }
    | undefined;
  /** Select this resource's CRUD segment from the transport. Default: `api[remoteKey]`. */
  readonly remote?: ((api: Api) => ResourceCrud<Dto>) | undefined;
  /** Sample wire DTOs that seed the derived mock. */
  readonly seed?: readonly Dto[] | undefined;
  /** Which mutations the remote allows. Default `"full"`. */
  readonly writeOps?: ResourceWriteOps | undefined;
}

/** A {@link ResourceDefinition} with defaults resolved. */
export interface NormalizedResource<C = any, Dto = any, Api = any>
  extends ResourceDefinition<C, Dto, Api> {
  readonly single: boolean;
  readonly format: "yaml" | "json";
  readonly workspaceField: string;
  readonly route: string;
  readonly key: string;
  readonly remoteKey: string;
  readonly dtoKey: string;
  readonly writeOps: ResourceWriteOps;
}

export function defineResource<C, Dto = any, Api = any>(
  def: ResourceDefinition<C, Dto, Api>,
): NormalizedResource<C, Dto, Api> {
  const single = def.single ?? false;
  const format = def.format ?? "yaml";
  const workspaceField = def.workspaceField ?? lowerFirst(def.schemaId);
  const route =
    def.route ?? (single ? `${workspaceField}.${format}` : `${workspaceField}/*.${format}`);
  const key = def.key ?? "id";
  return {
    ...def,
    single,
    format,
    workspaceField,
    route,
    key,
    remoteKey: def.remoteKey ?? workspaceField,
    dtoKey: def.dtoKey ?? key,
    writeOps: def.writeOps ?? "full",
  };
}

function lowerFirst(value: string): string {
  return value.length > 0 ? `${value[0]!.toLowerCase()}${value.slice(1)}` : value;
}
