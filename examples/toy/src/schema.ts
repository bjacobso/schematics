import { Relation } from "@schematics/algebra";
import { Schema } from "effect";

export const CARD_KIND = "card";
export const DECK_KIND = "deck";

export const CardSchema = Schema.Struct({
  id: Relation.id(CARD_KIND, { display: "title" }),
  title: Schema.String,
});
export type Card = typeof CardSchema.Type;

export const DeckSchema = Schema.Struct({
  id: Relation.id(DECK_KIND, { display: "name" }),
  name: Schema.String,
  cardIds: Relation.refs(CARD_KIND, { edge: "contains" }),
});
export type Deck = typeof DeckSchema.Type;

export const ToyWorkspaceSchema = Schema.Struct({
  cards: Schema.Array(CardSchema),
  decks: Schema.Array(DeckSchema),
});
export type ToyWorkspaceValue = typeof ToyWorkspaceSchema.Type;
