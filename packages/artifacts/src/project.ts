import { ArtifactApi, type AnyArtifactApi, type ArtifactCapability } from "./api";
import { ArtifactTypeDeclaration, type AnyArtifactType } from "./artifact-type";
import { ArtifactMatcher, type ArtifactMetadata } from "./matcher";
import { pathFromArtifactRef, type ArtifactRef } from "./ref";
import type { ArtifactViewConfig, ArtifactViewDefinition, ArtifactViewMap } from "./artifact-type";

export interface ArtifactFileRoute<Type extends AnyArtifactType = AnyArtifactType> {
  readonly id: string;
  readonly pattern: string;
  readonly type: Type;
  readonly metadata?: ArtifactMetadata | undefined;
}

export interface ArtifactProjectCapability extends ArtifactCapability {
  readonly routeId?: string | undefined;
  readonly routePattern?: string | undefined;
}

export interface ArtifactFileRouteOptions {
  readonly id?: string | undefined;
  readonly metadata?: ArtifactMetadata | undefined;
}

export class ArtifactProjectDeclaration<
  ProjectName extends string,
  Routes extends readonly ArtifactFileRoute[] = readonly [],
  WorkspaceViews extends ArtifactViewMap = Record<never, never>,
> {
  readonly _tag = "ArtifactProject";
  readonly workspaceType: ArtifactTypeDeclaration<`${ProjectName}.workspace`, WorkspaceViews>;

  constructor(
    readonly name: ProjectName,
    readonly routes: Routes = [] as unknown as Routes,
    workspaceType?: ArtifactTypeDeclaration<`${ProjectName}.workspace`, WorkspaceViews>,
  ) {
    this.workspaceType =
      workspaceType ??
      (ArtifactTypeDeclaration.create(`${name}.workspace` as `${ProjectName}.workspace`).match(
        ArtifactMatcher.tag("Workspace"),
      ) as unknown as ArtifactTypeDeclaration<`${ProjectName}.workspace`, WorkspaceViews>);
  }

  get api(): AnyArtifactApi {
    let api: AnyArtifactApi = ArtifactApi.make(this.name).add(
      this.workspaceType as unknown as AnyArtifactType,
    );
    for (const route of this.routes) {
      api = api.add(route.type);
    }
    return api;
  }

  files<Type extends AnyArtifactType>(
    pattern: string,
    type: Type,
    options: ArtifactFileRouteOptions = {},
  ): ArtifactProjectDeclaration<
    ProjectName,
    readonly [...Routes, ArtifactFileRoute<Type>],
    WorkspaceViews
  > {
    const route: ArtifactFileRoute<Type> = {
      id: options.id ?? pattern,
      pattern,
      type,
      ...(options.metadata ? { metadata: options.metadata } : {}),
    };
    return new ArtifactProjectDeclaration(
      this.name,
      [...this.routes, route] as const,
      this.workspaceType,
    );
  }

  view<ViewName extends Extract<keyof WorkspaceViews, string>>(
    name: ViewName,
  ): WorkspaceViews[ViewName];
  view<ViewName extends string, Input = undefined, Output = unknown, Error = unknown>(
    name: ViewName,
    config: ArtifactViewConfig<Input, Output, Error>,
  ): ArtifactProjectDeclaration<
    ProjectName,
    Routes,
    WorkspaceViews &
      Record<
        ViewName,
        ArtifactViewDefinition<`${ProjectName}.workspace`, ViewName, Input, Output, Error>
      >
  >;
  view(name: string, config?: ArtifactViewConfig<unknown, unknown, unknown>): unknown {
    if (!config) return this.workspaceType.view(name as never);
    return new ArtifactProjectDeclaration(
      this.name,
      this.routes,
      this.workspaceType.view(name, config) as ArtifactTypeDeclaration<
        `${ProjectName}.workspace`,
        WorkspaceViews
      >,
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
    if (ref._tag === "Workspace") {
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
  make: <ProjectName extends string>(name: ProjectName): ArtifactProjectDeclaration<ProjectName> =>
    new ArtifactProjectDeclaration(name),
} as const;

function matchGlob(pattern: string, path: string): boolean {
  const escaped = pattern
    .split("**")
    .map((part) => part.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*"))
    .join(".*");
  return new RegExp(`^${escaped}$`).test(path);
}
