import type { ArtifactMatchInput, ArtifactMetadata } from "./matcher";
import type { ArtifactRef } from "./ref";
import type { AnyArtifactType, AnyArtifactView } from "./artifact-type";

export interface ArtifactCapability {
  readonly type: string;
  readonly view: string;
  readonly id: string;
  readonly inputSchema: unknown | null;
  readonly outputSchema: unknown;
  readonly errorSchema: unknown | null;
  readonly annotations: AnyArtifactView["annotations"];
}

export class ArtifactApiDeclaration<
  ApiName extends string,
  Types extends readonly AnyArtifactType[] = readonly [],
> {
  readonly _tag = "ArtifactApi";

  constructor(
    readonly name: ApiName,
    readonly types: Types = [] as unknown as Types,
  ) {}

  add<Type extends AnyArtifactType>(
    artifactType: Type,
  ): ArtifactApiDeclaration<ApiName, readonly [...Types, Type]> {
    return new ArtifactApiDeclaration(this.name, [...this.types, artifactType] as const);
  }

  match(ref: ArtifactRef, metadata?: ArtifactMetadata): readonly AnyArtifactType[] {
    const input = matchInput(ref, metadata);
    return this.types.filter((artifactType) => artifactType.matches(input));
  }

  capabilities(ref: ArtifactRef, metadata?: ArtifactMetadata): readonly ArtifactCapability[] {
    return capabilitiesForTypes(this.match(ref, metadata));
  }
}

export type AnyArtifactApi = ArtifactApiDeclaration<string, readonly AnyArtifactType[]>;

export const ArtifactApi = {
  make: <ApiName extends string>(name: ApiName): ArtifactApiDeclaration<ApiName> =>
    new ArtifactApiDeclaration(name),
  capabilities: (
    api: AnyArtifactApi,
    ref: ArtifactRef,
    metadata?: ArtifactMetadata,
  ): readonly ArtifactCapability[] => api.capabilities(ref, metadata),
} as const;

export function capabilitiesForTypes(
  artifactTypes: readonly AnyArtifactType[],
): readonly ArtifactCapability[] {
  return artifactTypes.flatMap((artifactType) =>
    artifactType.listViews().map((view) => ({
      type: view.type,
      view: view.name,
      id: view.id,
      inputSchema: view.input ?? null,
      outputSchema: view.output,
      errorSchema: view.error ?? null,
      annotations: view.annotations,
    })),
  );
}

function matchInput(ref: ArtifactRef, metadata?: ArtifactMetadata): ArtifactMatchInput {
  return metadata ? { ref, metadata } : { ref };
}
