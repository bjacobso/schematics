// Public-catalog preview components, one per resource type in the NYC Public
// Library example. Each renders the resource the way a patron-facing library
// website would — plainly, read-only — so a non-technical reader can grok what
// the resource *is* without reading YAML.

import type {
  AuthorConfig,
  BranchConfig,
  CatalogConfig,
  CollectionConfig,
  ItemConfig,
  LoanPolicyConfig,
  ShelfConfig,
} from "@schematics/example-catalog";
import type { SchematicsPreviewComponentProps } from "@schematics/ide";
import {
  authorNames,
  byline,
  BookIcon,
  ClockIcon,
  CollectionIcon,
  Detail,
  Empty,
  initials,
  LibraryCanvas,
  LibraryIcon,
  Panel,
  PinIcon,
  ResourceHero,
  Row,
  ShelfIcon,
  Stack,
  StatGrid,
  StatusBadge,
  Tag,
  UserIcon,
  useCatalogIndex,
} from "./library-kit";

// ── Catalog — the library system home page ─────────────────────────────────────

export function CatalogPreview(props: SchematicsPreviewComponentProps<CatalogConfig>) {
  const index = useCatalogIndex(props.files);
  const catalog = props.value;
  return (
    <LibraryCanvas>
      <ResourceHero
        eyebrow="Library system"
        tone="indigo"
        title={catalog?.name ?? "Untitled library"}
        subtitle={catalog?.system ? `System code · ${catalog.system}` : undefined}
        cover={<LibraryIcon className="h-9 w-9" />}
        issues={props.diagnostics.length}
      />
      <StatGrid
        stats={[
          { label: "Branches", value: index.branches.length },
          { label: "Books", value: index.items.length },
          { label: "Authors", value: index.authors.length },
          { label: "Collections", value: index.collections.length },
          { label: "Shelves", value: index.shelves.length },
          { label: "Loan policies", value: index.policies.length },
        ]}
      />
      <Panel title="Branches" count={index.branches.length}>
        {index.branches.length ? (
          <Stack>
            {index.branches.map((branch) => (
              <Row
                key={branch.id}
                tone="sky"
                icon={<PinIcon className="h-4 w-4" />}
                title={branch.name}
                subtitle={branch.address}
              />
            ))}
          </Stack>
        ) : (
          <Empty>No branches in this catalog yet.</Empty>
        )}
      </Panel>
      <Panel title="Collections" count={index.collections.length}>
        {index.collections.length ? (
          <Stack>
            {index.collections.map((collection) => (
              <Row
                key={collection.id}
                tone="rose"
                icon={<CollectionIcon className="h-4 w-4" />}
                title={collection.name}
                meta={`${collection.itemIds?.length ?? 0} books`}
              />
            ))}
          </Stack>
        ) : (
          <Empty>No collections yet.</Empty>
        )}
      </Panel>
    </LibraryCanvas>
  );
}

// ── Branch — a location page ────────────────────────────────────────────────────

export function BranchPreview(props: SchematicsPreviewComponentProps<BranchConfig>) {
  const index = useCatalogIndex(props.files);
  const branch = props.value;
  const here = branch ? index.items.filter((item) => item.homeBranchId === branch.id) : [];
  return (
    <LibraryCanvas>
      <ResourceHero
        eyebrow="Branch"
        tone="sky"
        title={branch?.name ?? "Untitled branch"}
        subtitle={branch?.address}
        cover={<PinIcon className="h-9 w-9" />}
        issues={props.diagnostics.length}
      />
      <Panel title="Collection held here" count={here.length}>
        {here.length ? (
          <Stack>
            {here.map((item) => (
              <Row
                key={item.id}
                tone="violet"
                title={item.title}
                subtitle={byline(authorNames(index, item.authorIds))}
                meta={`${item.copies?.length ?? 0} ${(item.copies?.length ?? 0) === 1 ? "copy" : "copies"}`}
              />
            ))}
          </Stack>
        ) : (
          <Empty>No books call this branch home.</Empty>
        )}
      </Panel>
    </LibraryCanvas>
  );
}

// ── Author — an author page ─────────────────────────────────────────────────────

export function AuthorPreview(props: SchematicsPreviewComponentProps<AuthorConfig>) {
  const index = useCatalogIndex(props.files);
  const author = props.value;
  const works = author
    ? index.items.filter((item) => (item.authorIds ?? []).includes(author.id))
    : [];
  return (
    <LibraryCanvas>
      <ResourceHero
        eyebrow="Author"
        tone="amber"
        title={author?.name ?? "Unknown author"}
        subtitle={`${works.length} ${works.length === 1 ? "work" : "works"} in this catalog`}
        cover={
          author?.name ? (
            <span className="text-2xl font-semibold">{initials(author.name)}</span>
          ) : (
            <UserIcon className="h-9 w-9" />
          )
        }
        issues={props.diagnostics.length}
      />
      <Panel title="Works in this catalog" count={works.length}>
        {works.length ? (
          <Stack>
            {works.map((item) => (
              <Row
                key={item.id}
                tone="violet"
                title={item.title}
                subtitle={
                  index.branchById.get(item.homeBranchId)?.name
                    ? `Home branch · ${index.branchById.get(item.homeBranchId)?.name}`
                    : undefined
                }
              />
            ))}
          </Stack>
        ) : (
          <Empty>No catalogued works reference this author.</Empty>
        )}
      </Panel>
    </LibraryCanvas>
  );
}

// ── Shelf — a physical location ─────────────────────────────────────────────────

export function ShelfPreview(props: SchematicsPreviewComponentProps<ShelfConfig>) {
  const index = useCatalogIndex(props.files);
  const shelf = props.value;
  const shelved = shelf
    ? index.items
        .map((item) => ({
          item,
          copies: (item.copies ?? []).filter((copy) => copy.shelf === shelf.id),
        }))
        .filter((entry) => entry.copies.length > 0)
    : [];
  const collections = shelf
    ? index.collections.filter((collection) => (collection.shelves ?? []).includes(shelf.id))
    : [];
  return (
    <LibraryCanvas>
      <ResourceHero
        eyebrow="Shelf location"
        tone="emerald"
        title={shelf?.label ?? "Unlabelled shelf"}
        subtitle={shelf?.id ? `Call location · ${shelf.id}` : undefined}
        cover={<ShelfIcon className="h-9 w-9" />}
        issues={props.diagnostics.length}
      />
      <Panel title="On this shelf" count={shelved.length}>
        {shelved.length ? (
          <Stack>
            {shelved.map(({ item, copies }) => (
              <Row
                key={item.id}
                tone="violet"
                title={item.title}
                subtitle={byline(authorNames(index, item.authorIds))}
                meta={copies.map((copy) => copy.barcode).join(", ")}
              />
            ))}
          </Stack>
        ) : (
          <Empty>No copies are shelved here.</Empty>
        )}
      </Panel>
      {collections.length ? (
        <Panel title="Featured in collections" count={collections.length}>
          <Stack>
            {collections.map((collection) => (
              <Row
                key={collection.id}
                tone="rose"
                icon={<CollectionIcon className="h-4 w-4" />}
                title={collection.name}
              />
            ))}
          </Stack>
        </Panel>
      ) : null}
    </LibraryCanvas>
  );
}

// ── Item — the catalogue record (centerpiece) ───────────────────────────────────

export function ItemPreview(props: SchematicsPreviewComponentProps<ItemConfig>) {
  const index = useCatalogIndex(props.files);
  const item = props.value;
  const authors = authorNames(index, item?.authorIds);
  const branchName = item
    ? (index.branchById.get(item.homeBranchId)?.name ?? item.homeBranchId)
    : "";
  const copies = item?.copies ?? [];
  const holds = item?.holds ?? [];
  const available = Math.max(0, copies.length - holds.length);

  const availability =
    copies.length === 0 ? (
      <StatusBadge tone="muted">Reference only · no copies</StatusBadge>
    ) : available === 0 ? (
      <StatusBadge tone="warn">All {copies.length} copies on hold</StatusBadge>
    ) : (
      <StatusBadge tone="good">
        {available} of {copies.length} available
      </StatusBadge>
    );

  return (
    <LibraryCanvas>
      <ResourceHero
        eyebrow="Catalogue record"
        tone="violet"
        title={item?.title ?? "Untitled work"}
        subtitle={byline(authors) || undefined}
        cover={<BookIcon className="h-9 w-9" />}
        issues={props.diagnostics.length}
        aside={
          <>
            {availability}
            {branchName ? (
              <Tag>
                <PinIcon className="mr-1 inline h-3 w-3 align-[-1px]" />
                {branchName}
              </Tag>
            ) : null}
          </>
        }
      />

      <Panel title="Where to find it">
        <Detail label="Home branch" value={branchName || "—"} />
        {copies.length ? (
          <div className="mt-1 grid gap-2">
            {copies.map((copy) => (
              <Row
                key={copy.barcode}
                tone="emerald"
                icon={<ShelfIcon className="h-4 w-4" />}
                title={index.shelfById.get(copy.shelf)?.label ?? copy.shelf}
                subtitle={`Barcode ${copy.barcode}`}
                meta={copy.condition ? copyCondition(copy.condition) : undefined}
              />
            ))}
          </div>
        ) : (
          <Empty>No physical copies in the system.</Empty>
        )}
      </Panel>

      <Panel title="Editions" count={item?.editions?.length ?? 0}>
        {item?.editions?.length ? (
          <Stack>
            {item.editions.map((edition) => (
              <Row
                key={edition.isbn}
                tone="amber"
                icon={<BookIcon className="h-4 w-4" />}
                title={edition.label}
                subtitle={`ISBN ${edition.isbn}`}
                meta={edition.year}
              />
            ))}
          </Stack>
        ) : (
          <Empty>No editions recorded.</Empty>
        )}
      </Panel>

      {holds.length ? (
        <Panel title="Hold queue" count={holds.length}>
          <Stack>
            {holds.map((hold, position) => (
              <Row
                key={`${hold.patron}-${hold.copy}`}
                tone="rose"
                icon={<UserIcon className="h-4 w-4" />}
                title={hold.patron}
                subtitle={`Waiting on copy ${hold.copy}`}
                meta={`#${position + 1} in line`}
              />
            ))}
          </Stack>
        </Panel>
      ) : null}
    </LibraryCanvas>
  );
}

function copyCondition(condition: "new" | "good" | "worn"): string {
  return condition === "new" ? "New" : condition === "good" ? "Good condition" : "Well-loved";
}

// ── Collection — a curated reading list ─────────────────────────────────────────

export function CollectionPreview(props: SchematicsPreviewComponentProps<CollectionConfig>) {
  const index = useCatalogIndex(props.files);
  const collection = props.value;
  const items = (collection?.itemIds ?? []).map((id) => ({
    id,
    item: index.itemById.get(id) ?? null,
  }));
  const shelves = (collection?.shelves ?? []).map((id) => index.shelfById.get(id)?.label ?? id);
  return (
    <LibraryCanvas>
      <ResourceHero
        eyebrow="Curated collection"
        tone="rose"
        title={collection?.name ?? "Untitled collection"}
        subtitle={`${items.length} ${items.length === 1 ? "book" : "books"}`}
        cover={<CollectionIcon className="h-9 w-9" />}
        issues={props.diagnostics.length}
      />
      <Panel title="In this collection" count={items.length}>
        {items.length ? (
          <Stack>
            {items.map(({ id, item }) => (
              <Row
                key={id}
                tone="violet"
                title={item?.title ?? id}
                subtitle={
                  item ? byline(authorNames(index, item.authorIds)) : "Not found in catalogue"
                }
              />
            ))}
          </Stack>
        ) : (
          <Empty>This collection is empty.</Empty>
        )}
      </Panel>
      {shelves.length ? (
        <Panel title="Find them on" count={shelves.length}>
          <Stack>
            {shelves.map((label) => (
              <Row
                key={label}
                tone="emerald"
                icon={<ShelfIcon className="h-4 w-4" />}
                title={label}
              />
            ))}
          </Stack>
        </Panel>
      ) : null}
    </LibraryCanvas>
  );
}

// ── Loan policy — the borrowing rules ───────────────────────────────────────────

export function LoanPolicyPreview(props: SchematicsPreviewComponentProps<LoanPolicyConfig>) {
  const index = useCatalogIndex(props.files);
  const policy = props.value;
  const shelfLabel = policy?.primaryShelf
    ? (index.shelfById.get(policy.primaryShelf)?.label ?? policy.primaryShelf)
    : null;
  return (
    <LibraryCanvas>
      <ResourceHero
        eyebrow="Borrowing policy"
        tone="teal"
        title={policy?.name ?? "Untitled policy"}
        subtitle={index.catalog?.name ? `Applies across ${index.catalog.name}` : undefined}
        cover={<ClockIcon className="h-9 w-9" />}
        issues={props.diagnostics.length}
      />
      <Panel title="Borrowing terms">
        <div className="flex items-baseline gap-2 py-2">
          <span className="text-4xl font-semibold text-foreground">{policy?.loanDays ?? "—"}</span>
          <span className="text-sm text-muted-foreground">day lending period</span>
        </div>
        <Detail label="Primary shelf" value={shelfLabel ?? "Not assigned"} />
      </Panel>
    </LibraryCanvas>
  );
}
