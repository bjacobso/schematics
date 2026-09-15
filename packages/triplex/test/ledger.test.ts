import { TransactionId, Triples } from "@bjacobso/triplex";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { DeclarationLedger, memoryLayer } from "../src";

describe("DeclarationLedger", () => {
  it("publishes immutable declaration releases and reports semantic changes", async () => {
    const program = Effect.gen(function* () {
      const ledger = yield* DeclarationLedger;
      const first = yield* ledger.publish({
        label: "Initial declarations",
        files: [{ path: "cards/welcome.yaml", content: "name: Welcome\n" }],
      });
      const second = yield* ledger.publish({
        label: "Rename welcome card",
        files: [{ path: "cards/welcome.yaml", content: "name: Hello\n" }],
      });
      const current = yield* ledger.current();
      const history = yield* ledger.history;
      const changes = yield* ledger.changes(first.snapshotId, second.snapshotId);
      return { first, second, current, history, changes };
    }).pipe(Effect.provide(memoryLayer("ledger-release-test")));

    const result = await Effect.runPromise(program);
    expect(result.current?.snapshotId).toBe(result.second.snapshotId);
    expect(result.history).toHaveLength(2);
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]).toMatchObject({
      _tag: "ObjectChanged",
      kind: "schematics/declaration",
      key: "cards/welcome.yaml",
      dataChanged: true,
    });
  });

  it("pins provider observations to the exact declaration release", async () => {
    const program = Effect.gen(function* () {
      const ledger = yield* DeclarationLedger;
      const release = yield* ledger.publish({
        label: "Deploy basis",
        ref: "live",
        files: [{ path: "cards/welcome.yaml", content: "name: Welcome\n" }],
      });
      const receipt = yield* ledger.recordObservations(
        release.snapshotId,
        [
          {
            resourceId: "card:welcome",
            kind: "Card",
            state: { name: "Welcome" },
            observedAt: 1_789_430_400_000,
            etag: "v1",
          },
        ],
        "provider:toy",
      );
      const triples = yield* Triples;
      const transaction = yield* triples.transaction(TransactionId.make(receipt.transactionId));
      return { receipt, transaction };
    }).pipe(Effect.provide(memoryLayer("ledger-observation-test")));

    const { receipt, transaction } = await Effect.runPromise(program);
    expect(receipt.declarationSnapshotId).toMatch(/^sha256-/);
    expect(receipt.observationCount).toBe(1);
    expect(receipt.position).toBeGreaterThan(0);
    expect(transaction).toMatchObject({
      actor: "provider:toy",
      configSnapshot: receipt.declarationSnapshotId,
    });
    expect(transaction?.changes).toHaveLength(5);
  });
});
