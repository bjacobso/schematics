import type { ArtifactProjectDeclaration, ArtifactStore } from "@schematics/artifacts";
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
  /** Provider id — namespaces routes/kinds and ids the project. */
  readonly id: string;
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
  const project = deriveArtifactProject({
    id: options.id,
    resources,
    include: options.include,
    metadata: options.metadata,
    secret: options.secret,
  });
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
            projectId: deployOptions.projectId ?? options.id,
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
        projectId: deployOptions.projectId ?? options.id,
      }),
  };

  const flavor: SchematicsFlavor = {
    id: options.id,
    schema: projectSchema as any,
    project,
    defaultFormat,
    deploy,
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
    mock,
    makeDeployService,
  };
}
