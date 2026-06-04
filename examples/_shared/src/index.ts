// Domain-agnostic config-as-code plumbing shared by every example. No node, no
// react imports here, so node-less consumers (Cloudflare worker, browser) can
// use the deploy service. Node entries live in `./node`; UI in `./preview`.
export { yamlConfigCodec, slugify } from "./codec";
export { makeMemoryDeploySecretStore, type DeploySecretStore } from "./secret-store";
export {
  makeConfigDeployService,
  toDeployError,
  type ConnectedDeploy,
  type ConfigDeployServiceOptions,
} from "./deploy-service";
