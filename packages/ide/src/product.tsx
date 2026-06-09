import type { ComponentType, ReactNode } from "react";
import type {
  ProjectRouteMap,
  SchematicsFlavor,
  SchematicsFlavorAssistant,
} from "@schematics/core";
import { Schematics, type SchematicsProps } from "./Schematics";
import type { SchematicsPreviewRegistrationForRoutes } from "./preview";
import type { PreviewNavigationRegistration } from "./SchematicsArtifactProjectView";

/** @deprecated Use {@link SchematicsFlavorAssistant} from `@schematics/core`. */
export type SchematicsAssistantProfile = SchematicsFlavorAssistant;

export interface SchematicsUiProfile {
  readonly emptyState?: ReactNode | undefined;
  readonly headerActions?: ReactNode | undefined;
  readonly hideDebugByDefault?: boolean | undefined;
}

/**
 * A flavor plus its React-bound surface: title, previews, preview navigation,
 * and editor chrome. Extends the React-free {@link SchematicsFlavor} so a host
 * can read schema/project/files/deploy without importing the IDE.
 */
export interface SchematicsProduct<
  A = unknown,
  Routes extends ProjectRouteMap = ProjectRouteMap,
> extends SchematicsFlavor<A, Routes> {
  readonly title: ReactNode;
  readonly previews?: readonly SchematicsPreviewRegistrationForRoutes<Routes>[] | undefined;
  readonly previewNavigation?: readonly PreviewNavigationRegistration[] | undefined;
  readonly ui?: SchematicsUiProfile | undefined;
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
