import type { ArtifactProjectDeclaration, ArtifactStore } from "@schematics/artifacts";
import type { SchematicsDeployService } from "@schematics/protocol";
import type { Duration } from "effect";
import type { ProjectRouteMap } from "./project-schema";
import type { SchematicsDocumentFormat, SourceFile } from "./types";
import type { SchematicsInputSchema } from "./validation";

/** Which surface a flavor opens in by default. */
export type SchematicsEditorMode = "code" | "preview";

/** Assistant defaults a flavor ships: a system prompt and starter prompts. */
export interface SchematicsFlavorAssistant {
  readonly systemPrompt?: string | undefined;
  readonly suggestedPrompts?: readonly string[] | undefined;
}

/**
 * Runtime inputs the host supplies when instantiating a flavor's deploy engine.
 * The flavor owns the API adapter + provider wiring (via its `createService`);
 * the host owns the working-tree store and the clock.
 */
export interface SchematicsFlavorDeployOptions {
  readonly store: ArtifactStore;
  readonly now?: (() => string) | undefined;
  readonly throttle?: { readonly interval?: Duration.Input } | undefined;
  readonly projectId?: string | undefined;
}

/** A flavor's deploy capability: a factory that builds its deploy service. */
export interface SchematicsFlavorDeploy {
  readonly createService: (options: SchematicsFlavorDeployOptions) => SchematicsDeployService;
}

/**
 * The React-free core of a Schematics flavor: everything a host needs to mount
 * a flavor's workspace and lifecycle without importing any UI. The IDE's
 * `SchematicsProduct` extends this with React-bound surface (title, previews,
 * chrome).
 */
export interface SchematicsFlavor<A = unknown, Routes extends ProjectRouteMap = ProjectRouteMap> {
  readonly id: string;
  readonly schema?: SchematicsInputSchema<A, Routes> | undefined;
  readonly project?: ArtifactProjectDeclaration<string, any, any> | undefined;
  readonly defaultFormat?: SchematicsDocumentFormat | undefined;
  readonly initialFiles?: readonly SourceFile[] | undefined;
  readonly ingestors?: readonly unknown[] | undefined;
  readonly assistant?: SchematicsFlavorAssistant | undefined;
  readonly defaultMode?: SchematicsEditorMode | undefined;
  readonly deploy?: SchematicsFlavorDeploy | undefined;
}
