import type { ComponentType, ReactNode } from "react";
import type { ArtifactProjectDeclaration } from "@schematics/artifacts";
import type {
  ProjectRouteMap,
  SchematicsDocumentFormat,
  SchematicsInputSchema,
  SourceFile,
} from "@schematics/core";
import { Schematics, type SchematicsProps } from "./Schematics";
import type { SchematicsEditorMode, SchematicsPreviewRegistrationForRoutes } from "./preview";

export interface SchematicsAssistantProfile {
  readonly systemPrompt?: string | undefined;
  readonly suggestedPrompts?: readonly string[] | undefined;
}

export interface SchematicsUiProfile {
  readonly emptyState?: ReactNode | undefined;
  readonly headerActions?: ReactNode | undefined;
  readonly hideDebugByDefault?: boolean | undefined;
}

export interface SchematicsProduct<A = unknown, Routes extends ProjectRouteMap = ProjectRouteMap> {
  readonly id: string;
  readonly title: ReactNode;
  readonly schema?: SchematicsInputSchema<A, Routes> | undefined;
  readonly project?: ArtifactProjectDeclaration<string, any, any> | undefined;
  readonly defaultFormat?: SchematicsDocumentFormat | undefined;
  readonly initialFiles?: readonly SourceFile[] | undefined;
  readonly previews?: readonly SchematicsPreviewRegistrationForRoutes<Routes>[] | undefined;
  readonly assistant?: SchematicsAssistantProfile | undefined;
  readonly ui?: SchematicsUiProfile | undefined;
  readonly defaultMode?: SchematicsEditorMode | undefined;
}

export type SchematicsProductComponentProps<
  A = unknown,
  Routes extends ProjectRouteMap = ProjectRouteMap,
> = Partial<SchematicsProps<A, Routes>>;

export interface DefinedSchematicsProduct<
  A = unknown,
  Routes extends ProjectRouteMap = ProjectRouteMap,
> {
  readonly id: string;
  readonly title: ReactNode;
  readonly product: SchematicsProduct<A, Routes>;
  readonly Component: ComponentType<SchematicsProductComponentProps<A, Routes>>;
  readonly createProps: (
    props?: SchematicsProductComponentProps<A, Routes>,
  ) => SchematicsProps<A, Routes>;
}

export function defineSchematicsProduct<
  A = unknown,
  Routes extends ProjectRouteMap = ProjectRouteMap,
>(product: SchematicsProduct<A, Routes>): DefinedSchematicsProduct<A, Routes> {
  const createProps = (
    props: SchematicsProductComponentProps<A, Routes> = {},
  ): SchematicsProps<A, Routes> => {
    const base = product.project
      ? {
          project: product.project,
          ...(product.schema ? { schema: product.schema } : {}),
        }
      : { schema: product.schema };

    if (!product.project && !product.schema && !("artifacts" in props) && !("project" in props)) {
      throw new Error("defineSchematicsProduct requires a project, schema, or runtime override.");
    }

    return {
      ...base,
      title: product.title,
      defaultFormat: product.defaultFormat,
      initialFiles: product.initialFiles,
      previews: product.previews,
      defaultMode: product.defaultMode,
      showDebug: product.ui?.hideDebugByDefault ? false : undefined,
      ...props,
    } as SchematicsProps<A, Routes>;
  };

  const Component = (props: SchematicsProductComponentProps<A, Routes>) => (
    <Schematics {...createProps(props)} />
  );

  return {
    id: product.id,
    title: product.title,
    product,
    Component,
    createProps,
  };
}
