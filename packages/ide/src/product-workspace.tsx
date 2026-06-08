import { useEffect, useState } from "react";
import { createMemoryArtifactStore, type ArtifactStore } from "@schematics/artifacts";
import { createSchematicsArtifactRuntime } from "@schematics/core";
import type { SchematicsArtifactProjectService, SchematicsDeployService } from "@schematics/protocol";
import { type Duration, Effect } from "effect";
import { createSchematicsArtifactClient } from "./artifact-project-client";
import type { SchematicsProduct } from "./product";

export type SchematicsLocalWorkspaceProbe = "checking" | "local-filesystem" | "memory";

/**
 * Probe whether a local filesystem workspace is reachable: call
 * `getCapabilities` once and resolve to `"local-filesystem"`, falling back to
 * `"memory"`. Pass `skip` (e.g. for a hosted workspace) to short-circuit to
 * `"memory"`. Extracted from the playground so any host can mount a product
 * against either a served filesystem or an in-browser memory workspace.
 */
export function useSchematicsLocalWorkspaceProbe(
  workspace: SchematicsArtifactProjectService,
  options: { readonly skip?: boolean | undefined } = {},
): SchematicsLocalWorkspaceProbe {
  const skip = options.skip ?? false;
  const [mode, setMode] = useState<SchematicsLocalWorkspaceProbe>(skip ? "memory" : "checking");

  useEffect(() => {
    if (skip) {
      setMode("memory");
      return;
    }
    let cancelled = false;
    setMode("checking");
    Effect.runPromise(workspace.getCapabilities)
      .then(() => {
        if (!cancelled) setMode("local-filesystem");
      })
      .catch(() => {
        if (!cancelled) setMode("memory");
      });
    return () => {
      cancelled = true;
    };
  }, [skip, workspace]);

  return mode;
}

export interface SchematicsProductDeployDemo {
  readonly store: ArtifactStore;
  readonly workspace: SchematicsArtifactProjectService;
  readonly deploy: SchematicsDeployService;
}

export interface CreateSchematicsProductDeployDemoOptions {
  readonly store?: ArtifactStore | undefined;
  readonly now?: (() => string) | undefined;
  readonly throttle?: { readonly interval?: Duration.Input } | undefined;
}

/**
 * Wire a product's deploy engine to an in-browser editor that shares ONE
 * artifact store with the deploy service, starting from a blank tree: Connect +
 * Pull stream the resources into the file tree, and editing one drives a real
 * plan/apply. Generalizes the playground's former catalog-only demo to any
 * product that declares a `deploy`. Returns `null` when the product has no
 * deploy engine or no artifact project.
 */
export function createSchematicsProductDeployDemo(
  product: Pick<SchematicsProduct, "project" | "defaultFormat" | "title" | "deploy">,
  options: CreateSchematicsProductDeployDemoOptions = {},
): SchematicsProductDeployDemo | null {
  if (!product.deploy || !product.project) return null;
  const store = options.store ?? createMemoryArtifactStore();
  const projectId = product.project.name;
  const workspace = createSchematicsArtifactClient({
    artifacts: createSchematicsArtifactRuntime({
      project: product.project,
      files: [],
      activeFile: null,
      activeFormat: product.defaultFormat ?? "yaml",
      projectId,
      store,
    }),
    ...(typeof product.title === "string" ? { title: product.title } : {}),
    projectId,
  });
  const deploy = product.deploy.createService({
    store,
    projectId,
    ...(options.now ? { now: options.now } : {}),
    ...(options.throttle ? { throttle: options.throttle } : {}),
  });
  return { store, workspace, deploy };
}
