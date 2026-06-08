// Node-using entry points (filesystem store + deploy CLI harness). Kept off the
// main index so node-less consumers (Cloudflare worker, browser) don't pull in
// node:fs.
export { createFsArtifactStore } from "./fs-store";
export {
  runDeployCli,
  runDeployCliEffect,
  type DeployCliConfig,
  type DeployCliFlags,
  type DeployCliOptions,
  type DeployCliResult,
} from "./cli";
