import type { Card, Deck } from "./schema";

export interface ToySeed extends Readonly<Record<string, readonly unknown[]>> {
  readonly cards: readonly Card[];
  readonly decks: readonly Deck[];
}

export const validToySeed: ToySeed = {
  cards: [
    { id: "welcome", title: "Welcome" },
    { id: "setup", title: "Set up your account" },
  ],
  decks: [{ id: "onboarding", name: "Onboarding", cardIds: ["welcome", "setup"] }],
};

export const toySeeds = { valid: validToySeed } as const satisfies Record<string, ToySeed>;
export type ToySeedName = keyof typeof toySeeds;
