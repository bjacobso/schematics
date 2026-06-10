import {
  matchGlob,
  type ArtifactProjectDeclaration,
  type ArtifactStore,
} from "@schematics/artifacts";
import type { ArtifactWorkflowIngestor } from "@schematics/ingest";
import type {
  SchematicsDocumentFormat,
  SchematicsFlavor,
  SchematicsFlavorDeploy,
  SchematicsFlavorDeployOptions,
} from "@schematics/core";
import {
  makeConfigDeployService,
  toDeployError,
  type ConnectedDeploy,
  type DeployConnectionStore,
  type DeploySecretStore,
} from "@schematics/deploy";
import type {
  DeployConnectionOptions,
  DeployConnectRequest,
  SchematicsDeployService,
} from "@schematics/protocol";
import { Effect, type Schema } from "effect";
import {
  deriveArtifactProject,
  deriveProjectSchema,
  deriveWorkspaceDiagnostics,
  deriveWorkspaceSchema,
} from "./derive";
import { deriveMockTransport, type DerivedMockTransport } from "./mock";
import { makeProviderConfigDeploy } from "./reconcile";
import type { NormalizedResource } from "./resource";

export interface DefineProviderOptions {
  /** Provider id — namespaces the deploy/flavor surface. */
  readonly id: string;
  /** Artifact project id. Default: `id`. */
  readonly projectId?: string | undefined;
  readonly title?: string | undefined;
  readonly resources: readonly NormalizedResource[];
  /** Connection choices (environments + auth) for the Connect step. */
  readonly connection: DeployConnectionOptions;
  /** Consumer label captured on the connection. Default: `id`. */
  readonly consumer?: string | undefined;
  /** Kinds enabled on a fresh connection. Default: every resource's kind. */
  readonly defaultKinds?: readonly string[] | undefined;
  readonly defaultFormat?: SchematicsDocumentFormat | undefined;
  readonly include?: readonly string[] | undefined;
  readonly metadata?: readonly string[] | undefined;
  readonly secret?: readonly string[] | undefined;
  readonly ingestors?: readonly ArtifactWorkflowIngestor<any, any>[] | undefined;
  /** Build the live API from a connect request. Default: a fresh derived mock. */
  readonly transport?: ((request: DeployConnectRequest) => unknown) | undefined;
  /** Seed for the default mock transport (per `remoteKey`). */
  readonly mockSeed?: Readonly<Record<string, readonly any[]>> | undefined;
  /** Resolve the connected account label. Default: `null`. */
  readonly account?: ((api: any) => Effect.Effect<string | null, any>) | undefined;
}

export interface DeployServiceOptions extends SchematicsFlavorDeployOptions {
  readonly connections?: DeployConnectionStore | undefined;
  readonly secrets?: DeploySecretStore | undefined;
}

export interface DefinedProvider {
  readonly id: string;
  readonly title: string;
  readonly resources: readonly NormalizedResource[];
  readonly connection: DeployConnectionOptions;
  readonly project: ArtifactProjectDeclaration<string, any, any>;
  readonly workspaceSchema: Schema.Schema<any>;
  readonly projectSchema: import("@schematics/core").ProjectSchema<any>;
  readonly projectDiagnostics: (
    value: any,
    context: { readonly files: readonly import("@schematics/core").SourceFile[] },
  ) => readonly import("@schematics/core").SchematicsDiagnostic[];
  readonly defaultFormat: SchematicsDocumentFormat;
  /** The React-free flavor surface — drops into the IDE/playground harness. */
  readonly flavor: SchematicsFlavor;
  readonly deploy: SchematicsFlavorDeploy;
  readonly ingestors: readonly ArtifactWorkflowIngestor<any, any>[];
  readonly mock: (seed?: Readonly<Record<string, readonly any[]>>) => DerivedMockTransport;
  readonly makeDeployService: (options: DeployServiceOptions) => SchematicsDeployService;
}

/**
 * Compose a set of resources + a connection + a transport into one system's
 * config-as-code provider: a derived artifact project, relation schema +
 * validation, deploy service, mock, and a {@link SchematicsFlavor} that mounts
 * in the IDE/playground harness with no glue.
 */
export function defineProvider(options: DefineProviderOptions): DefinedProvider {
  const resources = options.resources;
  const projectId = options.projectId ?? options.id;
  const project = deriveArtifactProject({
    id: projectId,
    resources,
    include: options.include,
    metadata: options.metadata,
    secret: options.secret,
    generated: [".schematics/runs/**"],
  });
  const ingestors = normalizeIngestors(project, options.ingestors ?? []);
  const workspaceSchema = deriveWorkspaceSchema(resources);
  const projectSchema = deriveProjectSchema(project, workspaceSchema, resources);
  const diagnose = deriveWorkspaceDiagnostics(workspaceSchema, resources);
  const defaultFormat: SchematicsDocumentFormat = options.defaultFormat ?? "yaml";
  const defaultKinds = options.defaultKinds ?? resources.map((resource) => resource.kind);
  const consumer = options.consumer ?? options.id;

  const mock = (seed?: Readonly<Record<string, readonly any[]>>): DerivedMockTransport =>
    deriveMockTransport(resources, { seed: seed ?? options.mockSeed });
  const transport = options.transport ?? ((): unknown => mock().api);

  const makeDeployService = (deployOptions: DeployServiceOptions): SchematicsDeployService =>
    makeConfigDeployService({
      store: deployOptions.store,
      connectionOptions: options.connection,
      defaultKinds: [...defaultKinds],
      consumer,
      ...(deployOptions.connections ? { connections: deployOptions.connections } : {}),
      ...(deployOptions.secrets ? { secrets: deployOptions.secrets } : {}),
      ...(deployOptions.now ? { now: deployOptions.now } : {}),
      connect: (request: DeployConnectRequest, store: ArtifactStore) =>
        Effect.gen(function* () {
          const api = transport(request);
          const account = options.account
            ? yield* options.account(api).pipe(Effect.mapError(toDeployError))
            : null;
          const deploy = makeProviderConfigDeploy(resources, {
            store,
            api,
            projectId: deployOptions.projectId ?? projectId,
            ...(deployOptions.throttle ? { throttle: deployOptions.throttle } : {}),
          });
          return { deploy, account } satisfies ConnectedDeploy;
        }),
    });

  const deploy: SchematicsFlavorDeploy = {
    createService: (deployOptions) =>
      makeDeployService({
        store: deployOptions.store,
        ...(deployOptions.now ? { now: deployOptions.now } : {}),
        ...(deployOptions.throttle ? { throttle: deployOptions.throttle } : {}),
        projectId: deployOptions.projectId ?? projectId,
      }),
  };

  const flavor: SchematicsFlavor = {
    id: options.id,
    schema: projectSchema as any,
    project,
    defaultFormat,
    deploy,
    ingestors,
  };

  return {
    id: options.id,
    title: options.title ?? options.id,
    resources,
    connection: options.connection,
    project,
    workspaceSchema,
    projectSchema,
    projectDiagnostics: (value, context) => diagnose(value, context.files),
    defaultFormat,
    flavor,
    deploy,
    ingestors,
    mock,
    makeDeployService,
  };
}

function normalizeIngestors(
  project: ArtifactProjectDeclaration<string, any, any>,
  ingestors: readonly ArtifactWorkflowIngestor<any, any>[],
): readonly ArtifactWorkflowIngestor<any, any>[] {
  const routeIds = new Set(project.routes.map((route: { readonly id: string }) => route.id));
  const knownCreatePatterns = [
    ...project.routes.map((route: { readonly pattern: string }) => route.pattern),
    ...(project.config.include ?? []),
  ];
  const ids = new Set<string>();

  for (const ingestor of ingestors) {
    if (ids.has(ingestor.id)) {
      throw new Error(`defineProvider(${project.name}): duplicate ingestor id ${ingestor.id}`);
    }
    ids.add(ingestor.id);

    for (const routeId of ingestor.targetRoutes) {
      if (!routeIds.has(routeId)) {
        throw new Error(
          `defineProvider(${project.name}): ingestor ${ingestor.id} targets unknown route ${routeId}`,
        );
      }
    }

    for (const pattern of ingestor.creates) {
      if (!knownCreatePatterns.some((known) => globPatternOverlaps(known, pattern))) {
        throw new Error(
          `defineProvider(${project.name}): ingestor ${ingestor.id} creates ${pattern}, ` +
            `which is not covered by a project route or include pattern`,
        );
      }
    }
  }

  return ingestors.map((ingestor) => ({
    ...ingestor,
    uses: [...new Set(ingestor.uses)].sort(),
  }));
}

function globPatternOverlaps(projectPattern: string, createPattern: string): boolean {
  const sample = createPattern.replace(/\*\*/g, "nested").replace(/\*/g, "sample");
  if (matchGlob(projectPattern, sample)) return true;
  if (matchGlob(projectPattern, createPattern)) return true;
  const projectPrefix = projectPattern.split("*", 1)[0] ?? "";
  const createPrefix = createPattern.split("*", 1)[0] ?? "";
  return Boolean(projectPrefix && createPrefix && createPrefix.startsWith(projectPrefix));
}
