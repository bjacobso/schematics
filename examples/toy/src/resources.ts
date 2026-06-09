import { defineResource } from "@schematics/provider";
import { CardSchema, CARD_KIND, DeckSchema, DECK_KIND } from "./schema";

export const toyResources = [
  defineResource<typeof CardSchema.Type>({
    kind: CARD_KIND,
    schemaId: "Cards",
    schema: CardSchema,
    description: "Reusable cards",
  }),
  defineResource<typeof DeckSchema.Type>({
    kind: DECK_KIND,
    schemaId: "Decks",
    schema: DeckSchema,
    description: "Decks that reference cards by id",
  }),
];
