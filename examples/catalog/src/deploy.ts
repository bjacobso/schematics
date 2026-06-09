import type { ArtifactStore } from "@schematics/artifacts";
import type { ConfigDeploy } from "@schematics/alchemy";
import { makeProviderConfigDeploy } from "@schematics/provider";
import type { Duration } from "effect";
import { makeMockCatalogApi, type CatalogApi } from "./api";
import { catalogResources } from "./resources";

export interface CatalogConfigDeployOptions {
  readonly store: ArtifactStore;
  /** Defaults to a fresh in-memory mock CatalogApi seeded with the NYC fixture. */
  readonly api?: CatalogApi | undefined;
  readonly lockfilePath?: string | undefined;
  readonly projectId?: string | undefined;
  /**
   * Global API throttle shared across pull and push. When set, one serial
   * min-spacing limiter wraps every provider call so the UI fills in over time.
   * Omit to disable; pass `{}` for one call per second.
   */
  readonly throttle?: { readonly interval?: Duration.Input } | undefined;
}

/** The resource kinds this example manages, in dependency-friendly order. */
export const CATALOG_KINDS: readonly string[] = catalogResources.map((resource) => resource.kind);

/**
 * Wire the catalog resources into the engine via the provider DSL: one derived
 * ResourceHandler per resource, the YAML codec, and the committed lockfile. The
 * mock/live {@link CatalogApi} is the transport — its segments are selected by
 * each resource's `remoteKey` (= workspace field).
 */
export function makeCatalogConfigDeploy(options: CatalogConfigDeployOptions): ConfigDeploy {
  const api = options.api ?? makeMockCatalogApi({ seed: emptySeed });
  return makeProviderConfigDeploy(catalogResources, {
    store: options.store,
    api,
    ...(options.projectId ? { projectId: options.projectId } : {}),
    ...(options.lockfilePath ? { lockfilePath: options.lockfilePath } : {}),
    ...(options.throttle ? { throttle: options.throttle } : {}),
  });
}

const emptySeed = {
  catalog: null,
  branches: [],
  authors: [],
  shelves: [],
  items: [],
  collections: [],
  loanPolicies: [],
} as const;
