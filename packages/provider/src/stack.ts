import type { SchematicsFlavor, SchematicsFlavorDeploy } from "@schematics/core";
import type { DefinedProvider } from "./provider";

export interface DefineStackOptions {
  readonly id: string;
  readonly title?: string | undefined;
  /** The providers this stack blends. v1 supports exactly one. */
  readonly providers: readonly DefinedProvider[];
}

export interface DefinedStack {
  readonly id: string;
  readonly title: string;
  readonly providers: readonly DefinedProvider[];
  /** The mounted flavor (single-provider in v1, ided as the stack). */
  readonly flavor: SchematicsFlavor;
  readonly deploy: SchematicsFlavorDeploy;
}

/**
 * Blend providers into the authored repo surface. v1 supports a single provider
 * (the flavor is namespaced as the stack); multi-provider blending +
 * cross-provider reference resolution is v2 (see docs/plan-provider-dsl.md).
 */
export function defineStack(options: DefineStackOptions): DefinedStack {
  if (options.providers.length === 0) {
    throw new Error(`defineStack(${options.id}): at least one provider is required`);
  }
  if (options.providers.length > 1) {
    throw new Error(
      `defineStack(${options.id}): multi-provider blending is not supported yet (v2). ` +
        `Provide a single provider.`,
    );
  }
  const provider = options.providers[0]!;
  return {
    id: options.id,
    title: options.title ?? provider.title,
    providers: options.providers,
    flavor: { ...provider.flavor, id: options.id },
    deploy: provider.deploy,
  };
}
