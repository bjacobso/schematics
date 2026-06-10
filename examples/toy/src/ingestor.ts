import {
  defineArtifactAction,
  defineArtifactIngestor,
  defineArtifactWorkflow,
  step,
} from "@schematics/ingest";
import { Effect, Schema } from "effect";

export const ToyTextCardInputSchema = Schema.Struct({
  sourcePath: Schema.String,
  slug: Schema.String,
});

const ToyTextSchema = Schema.Struct({
  text: Schema.String,
});

const ToyCardDraftSchema = Schema.Struct({
  slug: Schema.String,
  title: Schema.String,
});

const ToyTextCardOutputSchema = Schema.Struct({
  cardPath: Schema.String,
  reportPath: Schema.String,
});

const readToyTextSource = defineArtifactAction({
  id: "toy.text.readSource",
  input: ToyTextCardInputSchema,
  output: ToyTextSchema,
  run: ({ input, readFile }) =>
    readFile(input.sourcePath).pipe(Effect.map((text) => ({ text: text.trim() }))),
});

const inferToyCardDraft = defineArtifactAction({
  id: "toy.text.inferCard",
  input: Schema.Struct({
    slug: Schema.String,
    text: Schema.String,
  }),
  output: ToyCardDraftSchema,
  run: ({ input }) =>
    Effect.succeed({
      slug: input.slug,
      title: input.text.split(/\r?\n/, 1)[0]?.trim() || input.slug,
    }),
});

const emitToyCardYaml = defineArtifactAction({
  id: "toy.text.emitCardYaml",
  input: ToyCardDraftSchema,
  output: ToyTextCardOutputSchema,
  run: ({ input, writeFile }) =>
    Effect.gen(function* () {
      const cardPath = `cards/${input.slug}.yaml`;
      const reportPath = `reports/${input.slug}.yaml`;
      yield* writeFile(cardPath, `id: ${input.slug}\ntitle: ${input.title}\n`);
      yield* writeFile(
        reportPath,
        `source: toy-text-card\ngeneratedCard: ${cardPath}\nstatus: verified\n`,
      );
      return { cardPath, reportPath };
    }),
});

export const toyTextCardWorkflow = defineArtifactWorkflow<
  typeof ToyTextCardInputSchema.Type,
  typeof ToyTextCardOutputSchema.Type
>({
  id: "toy.text.cardFromText",
  input: ToyTextCardInputSchema,
  output: ToyTextCardOutputSchema,
  steps: {
    read: step(readToyTextSource),
    draft: step(inferToyCardDraft, {
      after: ["read"],
      input: ({ workflowInput, outputs }) => ({
        slug: workflowInput.slug,
        text: (outputs["read"] as typeof ToyTextSchema.Type).text,
      }),
    }),
    emit: step(emitToyCardYaml, {
      after: ["draft"],
      input: ({ outputs }) => outputs["draft"] as typeof ToyCardDraftSchema.Type,
    }),
  },
});

export const toyTextCardIngestor = defineArtifactIngestor({
  id: "toy.card.fromText",
  label: "Add card from text",
  accepts: [{ extension: "txt", mimeType: "text/plain" }],
  targetRoutes: ["Cards"],
  creates: ["cards/*.yaml", "reports/*.yaml"],
  inputs: ToyTextCardInputSchema,
  write: "apply",
  workflow: toyTextCardWorkflow,
});
