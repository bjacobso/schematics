import { EntityId, KvTriples, Triples } from "@bjacobso/triplex";
import { ConfigNode, ConfigStore, ContentId, InMemoryConfigStore } from "@bjacobso/triplex/config";
import type { SourceFileDto } from "@schematics/protocol";
import { Context, Data, Effect, Layer, Schema } from "effect";

export const DeclarationRelease = Schema.Struct({
  snapshotId: Schema.String,
  rootContentId: Schema.String,
  label: Schema.String,
  ref: Schema.String,
  sequence: Schema.Number,
  createdRevisionCount: Schema.Number,
  transactionId: Schema.String,
  position: Schema.Number,
});
export type DeclarationRelease = typeof DeclarationRelease.Type;

export const DeclarationReleaseSummary = Schema.Struct({
  snapshotId: Schema.String,
  rootContentId: Schema.String,
  label: Schema.String,
  sequence: Schema.Number,
  parentSnapshotId: Schema.NullOr(Schema.String),
  revisionCount: Schema.Number,
});
export type DeclarationReleaseSummary = typeof DeclarationReleaseSummary.Type;

export interface PublishDeclarationsInput {
  readonly files: readonly SourceFileDto[];
  readonly label: string;
  readonly ref?: string;
}

export interface ResourceObservation {
  readonly resourceId: string;
  readonly kind: string;
  readonly state: unknown;
  readonly observedAt: number;
  readonly etag?: string;
}

export const RecordedObservation = Schema.Struct({
  transactionId: Schema.String,
  position: Schema.Number,
  declarationSnapshotId: Schema.String,
  observationCount: Schema.Number,
});
export type RecordedObservation = typeof RecordedObservation.Type;

export class UnknownDeclarationRelease extends Data.TaggedError("UnknownDeclarationRelease")<{
  readonly snapshotId: string;
  readonly message: string;
}> {}

export interface DeclarationLedgerService {
  readonly publish: (input: PublishDeclarationsInput) => Effect.Effect<DeclarationRelease, unknown>;
  readonly current: (ref?: string) => Effect.Effect<DeclarationReleaseSummary | undefined, unknown>;
  readonly history: Effect.Effect<readonly DeclarationReleaseSummary[], unknown>;
  readonly changes: (
    fromSnapshotId: string,
    toSnapshotId: string,
  ) => Effect.Effect<readonly InMemoryConfigStore.ObjectChange[], unknown>;
  readonly recordObservations: (
    releaseSnapshotId: string,
    observations: readonly ResourceObservation[],
    actor?: string,
  ) => Effect.Effect<RecordedObservation, unknown>;
}

export class DeclarationLedger extends Context.Service<
  DeclarationLedger,
  DeclarationLedgerService
>()("schematics/DeclarationLedger") {}

const releaseSummary = (
  snapshot: InMemoryConfigStore.ConfigSnapshot,
): DeclarationReleaseSummary => ({
  snapshotId: snapshot.id,
  rootContentId: snapshot.rootCid,
  label: snapshot.label,
  sequence: snapshot.seq,
  parentSnapshotId: snapshot.parentId,
  revisionCount: snapshot.revisionIds.length,
});

const declarationNode = (file: SourceFileDto) =>
  ConfigNode.make({
    kind: "schematics/declaration",
    key: file.path,
    attrs: {
      path: file.path,
      content: file.content,
    },
  });

export const layer: Layer.Layer<DeclarationLedger, never, Triples | ConfigStore.ConfigStore> =
  Layer.effect(
    DeclarationLedger,
    Effect.gen(function* () {
      const triples = yield* Triples;
      const config = yield* ConfigStore.ConfigStore;

      return DeclarationLedger.of({
        publish: ({ files, label, ref = "draft" }) =>
          Effect.gen(function* () {
            const objects = yield* Effect.forEach(
              [...files].sort((left, right) => left.path.localeCompare(right.path)),
              declarationNode,
            );
            const committed = yield* config.commit({ label, objects, ref });
            return {
              ...releaseSummary(committed.snapshot),
              ref,
              createdRevisionCount: committed.created.length,
              transactionId: committed.transaction.txId,
              position: committed.transaction.position,
            };
          }),
        current: (ref = "draft") =>
          config
            .resolveRef(ref)
            .pipe(
              Effect.map((snapshot) =>
                snapshot === undefined ? undefined : releaseSummary(snapshot),
              ),
            ),
        history: config
          .load()
          .pipe(
            Effect.map((store) =>
              [...store.snapshots].sort((left, right) => right.seq - left.seq).map(releaseSummary),
            ),
          ),
        changes: (fromSnapshotId, toSnapshotId) =>
          Effect.gen(function* () {
            const store = yield* config.load();
            const from = InMemoryConfigStore.snapshotById(store, fromSnapshotId);
            if (from === undefined) {
              return yield* new UnknownDeclarationRelease({
                snapshotId: fromSnapshotId,
                message: `Unknown declaration release ${fromSnapshotId}`,
              });
            }
            const to = InMemoryConfigStore.snapshotById(store, toSnapshotId);
            if (to === undefined) {
              return yield* new UnknownDeclarationRelease({
                snapshotId: toSnapshotId,
                message: `Unknown declaration release ${toSnapshotId}`,
              });
            }
            return InMemoryConfigStore.changesBetween(store, from, to);
          }),
        recordObservations: (releaseSnapshotId, observations, actor = "provider") =>
          Effect.gen(function* () {
            if (!ContentId.isContentId(releaseSnapshotId)) {
              return yield* new UnknownDeclarationRelease({
                snapshotId: releaseSnapshotId,
                message: `Unknown declaration release ${releaseSnapshotId}`,
              });
            }
            const release = yield* config.snapshotById(releaseSnapshotId);
            if (release === undefined) {
              return yield* new UnknownDeclarationRelease({
                snapshotId: releaseSnapshotId,
                message: `Unknown declaration release ${releaseSnapshotId}`,
              });
            }
            const operations = observations.flatMap((observation, index) => {
              const id = EntityId.make(
                `schematics:observation:${observation.observedAt}:${index}:${observation.resourceId}`,
              );
              return [
                {
                  op: "assert" as const,
                  entityId: id,
                  entityType: "SchematicsObservation",
                  attribute: ":schematics.observation/resource-id",
                  value: { type: "string" as const, value: observation.resourceId },
                },
                {
                  op: "assert" as const,
                  entityId: id,
                  entityType: "SchematicsObservation",
                  attribute: ":schematics.observation/kind",
                  value: { type: "string" as const, value: observation.kind },
                },
                {
                  op: "assert" as const,
                  entityId: id,
                  entityType: "SchematicsObservation",
                  attribute: ":schematics.observation/state",
                  value: { type: "json" as const, value: observation.state },
                },
                {
                  op: "assert" as const,
                  entityId: id,
                  entityType: "SchematicsObservation",
                  attribute: ":schematics.observation/observed-at",
                  value: { type: "datetime" as const, value: observation.observedAt },
                },
                ...(observation.etag === undefined
                  ? []
                  : [
                      {
                        op: "assert" as const,
                        entityId: id,
                        entityType: "SchematicsObservation",
                        attribute: ":schematics.observation/etag",
                        value: { type: "string" as const, value: observation.etag },
                      },
                    ]),
              ];
            });
            const transaction = yield* triples.transact(operations, {
              actor,
              configSnapshot: releaseSnapshotId,
            });
            return {
              transactionId: transaction.txId,
              position: transaction.position,
              declarationSnapshotId: releaseSnapshotId,
              observationCount: observations.length,
            };
          }),
      });
    }),
  );

export const memoryLayer = (scope = "schematics") => {
  const database = ConfigStore.layer.pipe(Layer.provideMerge(KvTriples.layerWithScope(scope)));
  return Layer.merge(database, layer.pipe(Layer.provide(database)));
};
