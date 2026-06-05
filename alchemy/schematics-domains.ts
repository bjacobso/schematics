/**
 * Production custom-domain configuration for the Schematics Cloudflare stack.
 *
 * Custom hostnames are bound only when deploying the {@link PROD_STAGE} stage.
 * Alchemy infers the Cloudflare zone from each hostname, so the `schematics.run`
 * zone must already exist in the account the prod deploy authenticates against.
 * Preview and PR stages keep their per-stage `pages.dev` / `workers.dev` URLs.
 */

/** Alchemy stage name used by the production deploy (`alchemy deploy --stage prod`). */
export const PROD_STAGE = "prod";

/** Apex hostname served by the Playground (frontend) worker in production. */
export const PROD_PLAYGROUND_HOSTNAME = "schematics.run";

/** Hostname served by the API worker in production. */
export const PROD_API_HOSTNAME = "api.schematics.run";

/** Public origin the Playground should call for the API in production. */
export const PROD_API_BASE_URL = `https://${PROD_API_HOSTNAME}`;
