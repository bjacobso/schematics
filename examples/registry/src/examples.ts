export {
  schematicsExampleDefinitions,
  schematicsExamples,
  type SchematicsExample,
  type SchematicsExampleProjectDefinition,
} from "./generated/examples";
import { schematicsExamples } from "./generated/examples";
import type { SchematicsExample } from "./generated/examples";

export function randomSchematicsExample(): SchematicsExample {
  return (
    schematicsExamples[Math.floor(Math.random() * schematicsExamples.length)] ??
    schematicsExamples[0]!
  );
}
