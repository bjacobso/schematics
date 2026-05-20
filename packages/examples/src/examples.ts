export {
  schemaIdeExampleDefinitions,
  schemaIdeExamples,
  type SchemaIdeExample,
  type SchemaIdeExampleWorkspaceDefinition,
} from "./generated/examples";
import { schemaIdeExamples } from "./generated/examples";
import type { SchemaIdeExample } from "./generated/examples";

export function randomSchemaIdeExample(): SchemaIdeExample {
  return (
    schemaIdeExamples[Math.floor(Math.random() * schemaIdeExamples.length)] ?? schemaIdeExamples[0]!
  );
}
