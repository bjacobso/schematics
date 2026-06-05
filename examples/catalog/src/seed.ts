import type { CatalogSeed } from "./api";

/**
 * The New York Public Library fixture — the named, cross-referential demo
 * account this example pulls from. It is intentionally small but exercises every
 * relation: items point at a home branch (`ref`) and authors (`refs` + edge),
 * carry derived-id editions and item-scoped copies, holds reference a copy by
 * item-scoped id, a collection groups items and shelves, and loan policies are
 * scoped to the catalog.
 */
export const nycPublicLibrarySeed: CatalogSeed = {
  catalog: { id: "nypl", name: "New York Public Library", system: "NYPL" },
  branches: [
    {
      id: "schwarzman",
      name: "Stephen A. Schwarzman Building",
      address: "476 5th Ave, New York, NY",
    },
    {
      id: "lincoln-center",
      name: "Library for the Performing Arts",
      address: "40 Lincoln Center Plaza, New York, NY",
    },
  ],
  authors: [
    { id: "morrison", name: "Toni Morrison" },
    { id: "whitehead", name: "Colson Whitehead" },
    { id: "baldwin", name: "James Baldwin" },
  ],
  shelves: [
    { id: "fic-a-f", label: "Fiction A–F" },
    { id: "fic-g-m", label: "Fiction G–M" },
    { id: "fic-n-z", label: "Fiction N–Z" },
  ],
  items: [
    {
      id: "beloved",
      title: "Beloved",
      homeBranchId: "schwarzman",
      authorIds: ["morrison"],
      editions: [{ isbn: "9781400033416", label: "Vintage 2004", year: 2004 }],
      copies: [{ barcode: "33333001", shelf: "fic-a-f", condition: "good" }],
      holds: [{ patron: "A. Reader", copy: "33333001" }],
    },
    {
      id: "underground-railroad",
      title: "The Underground Railroad",
      homeBranchId: "schwarzman",
      authorIds: ["whitehead"],
      editions: [{ isbn: "9780385542364", label: "Doubleday 2016", year: 2016 }],
      copies: [{ barcode: "33333002", shelf: "fic-n-z" }],
    },
    {
      id: "giovannis-room",
      title: "Giovanni's Room",
      homeBranchId: "lincoln-center",
      authorIds: ["baldwin"],
      editions: [{ isbn: "9780345806567", label: "Vintage 2013" }],
      copies: [{ barcode: "33333003", shelf: "fic-g-m", condition: "worn" }],
    },
  ],
  collections: [
    {
      id: "staff-picks",
      name: "Staff Picks",
      itemIds: ["beloved", "underground-railroad"],
      shelves: ["fic-a-f", "fic-n-z"],
    },
  ],
  loanPolicies: [
    { id: "standard", name: "Standard Loan", loanDays: 21, primaryShelf: "fic-a-f" },
    { id: "new-release", name: "New Release", loanDays: 7 },
  ],
};

/** Named seeds the CLI/deploy can pull from via `--account`. */
export const catalogSeeds = {
  nypl: nycPublicLibrarySeed,
} as const satisfies Record<string, CatalogSeed>;

export type CatalogSeedName = keyof typeof catalogSeeds;
