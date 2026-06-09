import { defineProviderProject } from "@schematics/provider/cli";
import { toyProvider } from "./provider";

export const ToyConfigProject = defineProviderProject(toyProvider, { id: "toy-yaml" });
