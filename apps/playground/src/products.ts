import type { SchematicsProduct } from "@schematics/ide";
import { schematicsExamples, type SchematicsExample } from "@schematics/examples";
import { nycLibraryProductSurface } from "../../../examples/catalog/projects/nyc-public-library/product";
import { toyProductSurface } from "../../../examples/toy/projects/product";

// Per-flavor surface extras, keyed by example id and supplied by each flavor
// through the public `@schematics/*` API: previews, directory navigation, and a
// deploy engine. Flavors with no UI surface are absent and fall back to the
// data-only base product. The harness only collects them — it has no
// per-flavor knowledge of its own.
const productSurfacesById: Readonly<Record<string, Partial<SchematicsProduct>>> = {
  "nyc-library-yaml": nycLibraryProductSurface,
  "toy-valid": toyProductSurface,
  "toy-broken-refs": toyProductSurface,
  "toy-duplicate-ids": toyProductSurface,
};

function productFromExample(example: SchematicsExample): SchematicsProduct {
  return {
    id: example.id,
    title: example.name,
    schema: example.schema,
    project: example.project,
    defaultFormat: example.defaultFormat,
    initialFiles: example.files,
    ...(example.suggestedPrompts
      ? { assistant: { suggestedPrompts: example.suggestedPrompts } }
      : {}),
    ...productSurfacesById[example.id],
  };
}

/** Every example as a runnable {@link SchematicsProduct} the harness can mount. */
export const playgroundProducts: readonly SchematicsProduct[] =
  schematicsExamples.map(productFromExample);

export function getPlaygroundProduct(id: string): SchematicsProduct | undefined {
  return playgroundProducts.find((product) => product.id === id);
}

/**
 * The example the playground opens with: the NYC Public Library catalog, whose
 * deploy engine starts the workspace blank (Connect + Pull streams it in) — the
 * showcase flow the walkthrough captures. Falls back to the first product.
 */
export const defaultPlaygroundProduct: SchematicsProduct =
  getPlaygroundProduct("nyc-library-yaml") ?? playgroundProducts[0]!;

export function randomPlaygroundProduct(): SchematicsProduct {
  return (
    playgroundProducts[Math.floor(Math.random() * playgroundProducts.length)] ??
    playgroundProducts[0]!
  );
}
