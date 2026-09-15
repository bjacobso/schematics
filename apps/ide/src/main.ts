import { SchematicsArtifactProject } from "@schematics/protocol";
import { memoryLayer } from "@schematics/triplex";
import { Layer } from "effect";
import { Runtime } from "foldkit";
import { LoadWorkspace } from "./commands";
import { Message } from "./message";
import { initialModel, Model } from "./model";
import { createRpcArtifactProjectClient } from "./rpc-client";
import { update } from "./update";
import { view } from "./view";
import "./styles.css";

const apiBaseUrl = import.meta.env["VITE_SCHEMATICS_API_BASE_URL"] ?? "";
const resources = Layer.merge(
  Layer.succeed(SchematicsArtifactProject, createRpcArtifactProjectClient(apiBaseUrl)),
  memoryLayer("schematics-ide"),
);

const application = Runtime.makeApplication({
  Model,
  container: document.getElementById("root"),
  init: () => ({ model: initialModel, commands: [LoadWorkspace({})] }),
  update,
  view,
  resources,
  devTools: { Message },
});

Runtime.run(application);
