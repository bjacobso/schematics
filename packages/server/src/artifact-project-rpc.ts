import { Effect, Schema, Stream } from "effect";
import {
  SchematicsArtifactProjectRpcGroup,
  SchematicsReflectionSchema,
  toArtifactProjectRpcError,
  type ReadArtifactViewResponse,
  type SchematicsArtifactProjectService,
  type SchematicsReflectionDto,
} from "@schematics/protocol";

export const makeSchematicsArtifactProjectRpcHandlers = (
  artifactProject: SchematicsArtifactProjectService,
) =>
  SchematicsArtifactProjectRpcGroup.of({
    GetCapabilities: () =>
      artifactProject.getCapabilities.pipe(Effect.mapError(toArtifactProjectRpcError)),
    GetSnapshot: () => artifactProject.getSnapshot.pipe(Effect.mapError(toArtifactProjectRpcError)),
    WatchArtifactProject: () =>
      artifactProject.watchArtifactProject.pipe(Stream.mapError(toArtifactProjectRpcError)),
    ApplyArtifactProjectChange: (change) =>
      artifactProject.applyChange(change).pipe(Effect.mapError(toArtifactProjectRpcError)),
    GetHistory: () => artifactProject.getHistory.pipe(Effect.mapError(toArtifactProjectRpcError)),
    PreviewArtifactProjectFiles: (request) =>
      artifactProject.previewFiles(request).pipe(
        Effect.map(({ reflection }) => ({
          reflection: serializeReflection(reflection),
        })),
        Effect.mapError(toArtifactProjectRpcError),
      ),
    ListArtifactRefs: () =>
      artifactProject.listArtifactRefs.pipe(Effect.mapError(toArtifactProjectRpcError)),
    GetArtifactCapabilities: (request) =>
      artifactProject
        .getArtifactCapabilities(request)
        .pipe(Effect.mapError(toArtifactProjectRpcError)),
    ReadArtifactView: (request) =>
      artifactProject.readArtifactView(request).pipe(
        Effect.map((response) => serializeReadArtifactViewResponse(response)),
        Effect.mapError(toArtifactProjectRpcError),
      ),
    ApplyArtifactChange: (change) =>
      artifactProject.applyArtifactChange(change).pipe(Effect.mapError(toArtifactProjectRpcError)),
  });

export const makeSchematicsArtifactProjectRpcLayer = (
  artifactProject: SchematicsArtifactProjectService,
) =>
  SchematicsArtifactProjectRpcGroup.toLayer(
    makeSchematicsArtifactProjectRpcHandlers(artifactProject),
  );

function serializeReadArtifactViewResponse(response: ReadArtifactViewResponse) {
  if (response.view !== "reflection") return response;
  return {
    ...response,
    value: serializeReflection(response.value),
  };
}

function serializeReflection(value: unknown): SchematicsReflectionDto {
  const reflection = Schema.encodeUnknownSync(SchematicsReflectionSchema)(
    value,
  ) as SchematicsReflectionDto;
  return {
    ...reflection,
    schemas: reflection.schemas.map((schema) => ({
      id: schema.id,
      ...(schema.title === undefined ? {} : { title: schema.title }),
      ...(schema.description === undefined ? {} : { description: schema.description }),
      ...(schema.match === undefined ? {} : { match: schema.match }),
      jsonSchema: toJsonValue(schema.jsonSchema),
    })),
    activeJsonSchema: toJsonValue(reflection.activeJsonSchema),
    decodedValue: toJsonValue(reflection.decodedValue),
  };
}

function toJsonValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (Array.isArray(value)) return value.map((item) => toJsonValue(item, seen));
  if (typeof value !== "object") return null;
  if (seen.has(value)) return null;
  seen.add(value);

  const entries = Object.entries(value)
    .map(([key, item]) => [key, toJsonValue(item, seen)] as const)
    .filter(([, item]) => item !== undefined);
  return Object.fromEntries(entries);
}
