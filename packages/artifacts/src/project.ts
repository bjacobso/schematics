import { Schema } from "effect";
import { ArtifactApi, type AnyArtifactApi, type ArtifactCapability } from "./api";
import { matchGlob } from "./glob";
import { ArtifactTypeDeclaration, type AnyArtifactType } from "./artifact-type";
import { ArtifactMatcher, type ArtifactMetadata } from "./matcher";
import { CachePolicy, Cost } from "./policy";
import { pathFromArtifactRef, type ArtifactRef } from "./ref";
import type { ArtifactViewConfig, ArtifactViewDefinition, ArtifactViewMap } from "./artifact-type";

export interface ArtifactFileRoute<
  Type extends AnyArtifactType = AnyArtifactType,
  Value = unknown,
  Id extends string = string,
> {
  readonly id: Id;
  readonly pattern: string;
  readonly type: Type;
  readonly schema?: Schema.Schema<Value> | undefined;
  readonly metadata?: ArtifactMetadata | undefined;
  readonly config?: ArtifactProjectFileConfig | undefined;
}

export interface ArtifactProjectCapability extends ArtifactCapability {
  readonly routeId?: string | undefined;
  readonly routePattern?: string | undefined;
}

export interface ArtifactFileRouteOptions {
  readonly id?: string | undefined;
  readonly metadata?: ArtifactMetadata | undefined;
  readonly config?: ArtifactProjectFileConfig | undefined;
}

export interface ArtifactSchemaFileRouteConfig<
  Type extends AnyArtifactType = AnyArtifactType,
  A = unknown,
  Id extends string = string,
> {
  readonly type: Type;
  readonly schema: Schema.Schema<A>;
  readonly id?: Id | undefined;
  readonly metadata?: ArtifactMetadata | undefined;
  readonly config?: ArtifactProjectFileConfig | undefined;
}

export interface ArtifactProjectFileConfig {
  readonly id: string;
  readonly pattern: string;
  readonly artifact: string;
  readonly format?: string | undefined;
  readonly workspaceField?: string | undefined;
  readonly mode?: "file" | "files" | "values" | undefined;
  readonly indexBy?: string | undefined;
  readonly optional?: boolean | undefined;
  readonly description?: string | undefined;
  readonly metadata?: ArtifactMetadata | undefined;
}

export interface ArtifactProjectConfig {
  readonly id: string;
  readonly name?: string | undefined;
  readonly defaultFormat?: string | undefined;
  readonly include?: readonly string[] | undefined;
  readonly files: readonly ArtifactProjectFileConfig[];
  readonly algebra?: unknown;
}

export const ArtifactProjectRouteModeSchema = Schema.Literals(["file", "files", "values"] as const);

export const ArtifactMetadataSchema = Schema.Struct({
  mimeType: Schema.optional(Schema.String),
  mediaType: Schema.optional(Schema.String),
  extension: Schema.optional(Schema.String),
  tags: Schema.optional(Schema.Array(Schema.String)),
  attributes: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
});

export const ArtifactProjectFileConfigSchema = Schema.Struct({
  id: Schema.String,
  pattern: Schema.String,
  artifact: Schema.String,
  format: Schema.optional(Schema.String),
  workspaceField: Schema.optional(Schema.String),
  mode: Schema.optional(ArtifactProjectRouteModeSchema),
  indexBy: Schema.optional(Schema.String),
  optional: Schema.optional(Schema.Boolean),
  description: Schema.optional(Schema.String),
  metadata: Schema.optional(ArtifactMetadataSchema),
});

export const ArtifactProjectConfigSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.optional(Schema.String),
  defaultFormat: Schema.optional(Schema.String),
  include: Schema.optional(Schema.Array(Schema.String)),
  files: Schema.Array(ArtifactProjectFileConfigSchema),
  algebra: Schema.optional(Schema.Unknown),
});

export interface ArtifactProjectOptions {
  readonly name?: string | undefined;
  readonly defaultFormat?: string | undefined;
  readonly include?: readonly string[] | undefined;
  readonly algebra?: unknown;
}

export type ArtifactProjectConfigArtifact =
  | AnyArtifactType
  | {
      readonly type: AnyArtifactType;
      readonly schema?: Schema.Schema<unknown> | undefined;
      readonly metadata?: ArtifactMetadata | undefined;
    };

export interface ArtifactProjectFromConfigEnvironment {
  readonly artifacts: Readonly<Record<string, ArtifactProjectConfigArtifact>>;
}

export class ArtifactProjectDeclaration<
  ProjectName extends string,
  Routes extends readonly ArtifactFileRoute<any, any, any>[] = readonly [],
  ProjectViews extends ArtifactViewMap = Record<never, never>,
> {
  readonly _tag = "ArtifactProject";
  readonly projectType: ArtifactTypeDeclaration<`${ProjectName}.project`, ProjectViews>;

  constructor(
    readonly name: ProjectName,
    readonly routes: Routes = [] as unknown as Routes,
    projectType?: ArtifactTypeDeclaration<`${ProjectName}.project`, ProjectViews>,
    readonly config: ArtifactProjectOptions = {},
  ) {
    this.projectType =
      projectType ??
      (ArtifactTypeDeclaration.create(`${name}.project` as `${ProjectName}.project`)
        .match(ArtifactMatcher.tag("Project"))
        .match(ArtifactMatcher.tag("Workspace")) as unknown as ArtifactTypeDeclaration<
        `${ProjectName}.project`,
        ProjectViews
      >);
  }

  /**
   * @deprecated Use projectType. This compatibility alias is kept while older
   * host protocol code still names the root artifact a workspace.
   */
  get workspaceType(): ArtifactTypeDeclaration<`${ProjectName}.project`, ProjectViews> {
    return this.projectType;
  }

  get api(): AnyArtifactApi {
    let api: AnyArtifactApi = ArtifactApi.make(this.name).add(
      this.projectType as unknown as AnyArtifactType,
    );
    for (const route of this.routes) {
      api = api.add(route.type);
    }
    return api;
  }

  files<
    const Pattern extends string,
    Type extends AnyArtifactType,
    const Options extends ArtifactFileRouteOptions | undefined = undefined,
  >(
    pattern: Pattern,
    type: Type,
    options?: Options,
  ): ArtifactProjectDeclaration<
    ProjectName,
    readonly [...Routes, ArtifactFileRoute<Type, unknown, RouteIdFromOptions<Pattern, Options>>],
    ProjectViews
  >;
  files<
    const Pattern extends string,
    const Config extends ArtifactSchemaFileRouteConfig<AnyArtifactType, any, string>,
  >(
    pattern: Pattern,
    config: Config,
  ): ArtifactProjectDeclaration<
    ProjectName,
    readonly [
      ...Routes,
      ArtifactFileRoute<
        AnyArtifactType,
        SchemaValueFromConfig<Config>,
        RouteIdFromConfig<Pattern, Config>
      >,
    ],
    ProjectViews
  >;
  files(
    pattern: string,
    typeOrConfig: AnyArtifactType | ArtifactSchemaFileRouteConfig,
    options: ArtifactFileRouteOptions = {},
  ): ArtifactProjectDeclaration<
    ProjectName,
    readonly [...Routes, ArtifactFileRoute],
    ProjectViews
  > {
    const route = isSchemaFileRouteConfig(typeOrConfig)
      ? makeSchemaRoute(pattern, typeOrConfig)
      : makeRoute(pattern, typeOrConfig, options);
    return new ArtifactProjectDeclaration(
      this.name,
      [...this.routes, route] as const,
      this.projectType,
      this.config,
    );
  }

  configure(
    config: ArtifactProjectOptions,
  ): ArtifactProjectDeclaration<ProjectName, Routes, ProjectViews> {
    return new ArtifactProjectDeclaration(this.name, this.routes, this.projectType, {
      ...this.config,
      ...config,
    });
  }

  view<ViewName extends Extract<keyof ProjectViews, string>>(
    name: ViewName,
  ): ProjectViews[ViewName];
  view<ViewName extends string, Input = undefined, Output = unknown, Error = unknown>(
    name: ViewName,
    config: ArtifactViewConfig<Input, Output, Error>,
  ): ArtifactProjectDeclaration<
    ProjectName,
    Routes,
    ProjectViews &
      Record<
        ViewName,
        ArtifactViewDefinition<`${ProjectName}.project`, ViewName, Input, Output, Error>
      >
  >;
  view(name: string, config?: ArtifactViewConfig<unknown, unknown, unknown>): unknown {
    if (!config) return this.projectType.view(name as never);
    return new ArtifactProjectDeclaration(
      this.name,
      this.routes,
      this.projectType.view(name, config) as ArtifactTypeDeclaration<
        `${ProjectName}.project`,
        ProjectViews
      >,
      this.config,
    );
  }

  route(ref: ArtifactRef): readonly ArtifactFileRoute[] {
    const path = pathFromArtifactRef(ref);
    if (!path) return [];
    return this.routes.filter((route) => matchGlob(route.pattern, path));
  }

  capabilities(
    ref: ArtifactRef,
    metadata?: ArtifactMetadata,
  ): readonly ArtifactProjectCapability[] {
    if (ref._tag === "Project") {
      return this.api.capabilities(ref, metadata);
    }

    return this.route(ref).flatMap((route) =>
      route.type.listViews().map((view) => ({
        type: view.type,
        view: view.name,
        id: `${route.id}.${view.name}`,
        inputSchema: view.input ?? null,
        outputSchema: view.output,
        errorSchema: view.error ?? null,
        annotations: view.annotations,
        routeId: route.id,
        routePattern: route.pattern,
      })),
    );
  }
}

export const ArtifactProject = {
  make: <ProjectName extends string>(
    name: ProjectName,
    config?: ArtifactProjectOptions,
  ): ArtifactProjectDeclaration<ProjectName> =>
    new ArtifactProjectDeclaration(name, [], undefined, config),
  fromConfig,
  toConfig,
} as const;

export function fromConfig(
  config: ArtifactProjectConfig,
  environment: ArtifactProjectFromConfigEnvironment,
): ArtifactProjectDeclaration<string, any, any> {
  let project = ArtifactProject.make(config.id, {
    ...(config.name ? { name: config.name } : {}),
    ...(config.defaultFormat ? { defaultFormat: config.defaultFormat } : {}),
    ...(config.include ? { include: config.include } : {}),
    ...(config.algebra === undefined ? {} : { algebra: config.algebra }),
  }) as ArtifactProjectDeclaration<string, any, any>;

  for (const file of config.files) {
    const artifact = environment.artifacts[file.artifact];
    if (!artifact) {
      throw new Error(`Unknown artifact in project config: ${file.artifact}`);
    }

    const metadata = mergeRouteMetadata(file, artifactMetadata(artifact));
    const artifactType = artifactTypeFromConfigArtifact(artifact);
    const schema = artifactSchema(artifact);
    project = schema
      ? project.files(file.pattern, {
          id: file.id,
          type: artifactType,
          schema,
          metadata,
          config: file,
        })
      : project.files(file.pattern, artifactType, {
          id: file.id,
          metadata,
          config: file,
        });
  }

  return project;
}

export function toConfig(
  project: ArtifactProjectDeclaration<string, any, any>,
): ArtifactProjectConfig {
  return {
    id: project.name,
    ...(project.config.name ? { name: project.config.name } : {}),
    ...(project.config.defaultFormat ? { defaultFormat: project.config.defaultFormat } : {}),
    ...(project.config.include ? { include: project.config.include } : {}),
    files: project.routes.map((route: ArtifactFileRoute) => route.config ?? routeToConfig(route)),
    ...(project.config.algebra === undefined ? {} : { algebra: project.config.algebra }),
  };
}

function makeRoute<Type extends AnyArtifactType>(
  pattern: string,
  type: Type,
  options: ArtifactFileRouteOptions,
): ArtifactFileRoute<Type> {
  const route: ArtifactFileRoute<Type> = {
    id: options.id ?? pattern,
    pattern,
    type,
    ...(options.metadata ? { metadata: options.metadata } : {}),
    ...(options.config ? { config: options.config } : {}),
  };
  return route;
}

function mergeRouteMetadata(
  file: ArtifactProjectFileConfig,
  metadata: ArtifactMetadata | undefined,
): ArtifactMetadata {
  return {
    ...(metadata ?? {}),
    ...(file.metadata ?? {}),
    attributes: {
      ...(metadata?.attributes ?? {}),
      ...(file.metadata?.attributes ?? {}),
      artifact: file.artifact,
      ...(file.format ? { format: file.format } : {}),
      ...(file.workspaceField ? { workspaceField: file.workspaceField } : {}),
      ...(file.mode === "file" ? { single: true } : {}),
      ...(file.mode === "values" ? { values: true } : {}),
      ...(file.indexBy ? { indexBy: file.indexBy } : {}),
      ...(file.description ? { description: file.description } : {}),
      ...(file.optional === undefined ? {} : { optional: file.optional }),
    },
  };
}

function artifactTypeFromConfigArtifact(artifact: ArtifactProjectConfigArtifact): AnyArtifactType {
  return isConfigArtifactWithType(artifact) ? artifact.type : artifact;
}

function artifactSchema(
  artifact: ArtifactProjectConfigArtifact,
): Schema.Schema<unknown> | undefined {
  return isConfigArtifactWithType(artifact) ? artifact.schema : undefined;
}

function artifactMetadata(artifact: ArtifactProjectConfigArtifact): ArtifactMetadata | undefined {
  return isConfigArtifactWithType(artifact) ? artifact.metadata : undefined;
}

function isConfigArtifactWithType(
  artifact: ArtifactProjectConfigArtifact,
): artifact is Exclude<ArtifactProjectConfigArtifact, AnyArtifactType> {
  return !("_tag" in artifact && artifact._tag === "ArtifactType");
}

function artifactNameFromRoute(route: ArtifactFileRoute): string {
  const artifact = route.metadata?.attributes?.["artifact"];
  return typeof artifact === "string" ? artifact : route.type.name;
}

function makeSchemaRoute<
  const Pattern extends string,
  const Config extends ArtifactSchemaFileRouteConfig<AnyArtifactType, any, string>,
>(
  pattern: Pattern,
  config: Config,
): ArtifactFileRoute<
  AnyArtifactType,
  SchemaValueFromConfig<Config>,
  RouteIdFromConfig<Pattern, Config>
> {
  const type = withDecodedValueView(config.type, config.schema);
  return {
    id: (config.id ?? pattern) as RouteIdFromConfig<Pattern, Config>,
    pattern,
    type,
    schema: config.schema,
    ...(config.metadata ? { metadata: config.metadata } : {}),
    ...(config.config ? { config: config.config } : {}),
  };
}

function routeToConfig(route: ArtifactFileRoute): ArtifactProjectFileConfig {
  return {
    id: route.id,
    pattern: route.pattern,
    artifact: artifactNameFromRoute(route),
    ...(typeof route.metadata?.attributes?.["format"] === "string"
      ? { format: route.metadata.attributes["format"] }
      : {}),
    ...(typeof route.metadata?.attributes?.["workspaceField"] === "string"
      ? { workspaceField: route.metadata.attributes["workspaceField"] }
      : {}),
    ...(route.metadata?.attributes?.["single"] === true
      ? { mode: "file" as const }
      : route.metadata?.attributes?.["values"] === true
        ? { mode: "values" as const }
        : {}),
    ...(typeof route.metadata?.attributes?.["indexBy"] === "string"
      ? { indexBy: route.metadata.attributes["indexBy"] }
      : {}),
    ...(typeof route.metadata?.attributes?.["description"] === "string"
      ? { description: route.metadata.attributes["description"] }
      : {}),
    ...(typeof route.metadata?.attributes?.["optional"] === "boolean"
      ? { optional: route.metadata.attributes["optional"] }
      : {}),
    ...(route.metadata ? { metadata: route.metadata } : {}),
  };
}

export type ArtifactProjectRoutes<Project> =
  Project extends ArtifactProjectDeclaration<string, infer Routes, any> ? Routes : never;

export type ArtifactProjectRouteId<Project> = Extract<
  ArtifactProjectRoutes<Project>[number]["id"],
  string
>;

export type ArtifactProjectRouteValue<Project, Id extends string> =
  Extract<ArtifactProjectRoutes<Project>[number], { readonly id: Id }> extends ArtifactFileRoute<
    any,
    infer Value,
    any
  >
    ? Value
    : unknown;

type RouteIdFromOptions<Pattern extends string, Options> =
  NonNullable<Options> extends {
    readonly id: infer Id extends string;
  }
    ? Id
    : Pattern;

type RouteIdFromConfig<Pattern extends string, Config> = Config extends {
  readonly id: infer Id extends string;
}
  ? Id
  : Pattern;

type SchemaValueFromConfig<Config> = Config extends { readonly schema: Schema.Schema<infer A> }
  ? A
  : unknown;

function withDecodedValueView<A>(type: AnyArtifactType, schema: Schema.Schema<A>): AnyArtifactType {
  if (type.views["decodedValue"]) return type;

  return type.view("decodedValue", {
    output: schema,
    annotations: {
      cost: Cost.low,
      cache: CachePolicy.contentHash,
      mediaType: "application/json",
    },
  }) as unknown as AnyArtifactType;
}

function isSchemaFileRouteConfig(value: unknown): value is ArtifactSchemaFileRouteConfig {
  return Boolean(
    value &&
    typeof value === "object" &&
    "type" in value &&
    "schema" in value &&
    (value as { type?: { _tag?: unknown } }).type?._tag === "ArtifactType",
  );
}
