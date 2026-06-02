export * as Relation from "./relation";
export { RelationAnnotationKey, getRelationAnnotation } from "./annotations";
export { derivedId, id, key, parent, path, pathRef, pathRefs, ref, refs } from "./combinators";
export { buildRelationGraph } from "./graph";
export {
  buildEntityIndex,
  definitionLocations,
  patchSuggestions,
  referenceDiagnostics,
  references,
} from "./inspect";
export { validateRelations } from "./validate";
export type {
  AnySchema,
  RelationAnnotation,
  RelationDerivedIdAnnotation,
  RelationDefinition,
  RelationDiagnostic,
  RelationEntityIndex,
  RelationEntityIndexEntry,
  RelationGraph,
  RelationIdAnnotation,
  RelationKind,
  RelationParentScope,
  RelationPatchSuggestion,
  RelationPathScope,
  RelationRefAnnotation,
  RelationReference,
  RelationScope,
} from "./types";
