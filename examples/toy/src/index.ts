import { Relation, validateRelations, type RelationDiagnostic } from "@schematics/algebra";
import { ArtifactMatcher, ArtifactType } from "@schematics/artifacts";
import { ArtifactProject, Project, type SchematicsDiagnostic } from "@schematics/core";
import { Schema } from "effect";

/**
 * The toy schematic — the smallest interesting Schematics project: two artifact
 * kinds (`card`, `deck`) related by id. It folds the old survey/workflow demos
 * into one minimal example whose job is to *show diagnostics*: the bundled
 * `projects/` fixtures deliberately trip `unresolved-ref` and `duplicate-id`
 * states so the IDE lights up. Cross-file validation is done with the relation
 * algebra, exactly like the catalog example, just at two kinds instead of nine.
 */
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

const yamlArtifact = (name: string) =>
  ArtifactType.make(name).match(ArtifactMatcher.extension("yaml"));

export const ToyCardArtifact = yamlArtifact("toy.card");
export const ToyDeckArtifact = yamlArtifact("toy.deck");

export const ToyArtifactProject = ArtifactProject.make("toy-yaml")
  .files("cards/*.yaml", {
    id: "Cards",
    type: ToyCardArtifact,
    schema: CardSchema,
    metadata: {
      attributes: {
        schemaId: "Cards",
        workspaceField: "cards",
        values: true,
        format: "yaml",
        description: "Reusable cards",
      },
    },
  })
  .files("decks/*.yaml", {
    id: "Decks",
    type: ToyDeckArtifact,
    schema: DeckSchema,
    metadata: {
      attributes: {
        schemaId: "Decks",
        workspaceField: "decks",
        values: true,
        format: "yaml",
        description: "Decks that reference cards by id",
      },
    },
  });

export function validateToyWorkspaceValue(
  workspace: ToyWorkspaceValue,
): readonly SchematicsDiagnostic[] {
  return validateRelations(ToyWorkspaceSchema, workspace).map((diagnostic) => ({
    path: diagnostic.path.length > 0 ? diagnostic.path.join(".") : null,
    documentPath: documentPathFor(diagnostic),
    severity: "error",
    source: "cross-file",
    message: friendlyMessage(diagnostic),
  }));
}

function friendlyMessage(diagnostic: RelationDiagnostic): string {
  const relation = diagnostic.relation;
  if (diagnostic.code === "unresolved-ref" && "target" in relation) {
    return `Unknown ${relation.target}: ${relation.id}`;
  }
  if (diagnostic.code === "duplicate-id" && "type" in relation) {
    return `Duplicate ${relation.type} id: ${relation.id}`;
  }
  return diagnostic.message;
}

function documentPathFor(diagnostic: RelationDiagnostic): string {
  const relation = diagnostic.relation;
  const kind = "target" in relation ? relation.target : relation.type;
  const field = kind === CARD_KIND ? "cards" : "decks";
  if ("id" in relation) return `${field}.${relation.id}`;
  return diagnostic.path.length > 0 ? diagnostic.path.join(".") : "toy";
}

export const ToyProjectBaseSchema = Project.fromArtifactProject(ToyArtifactProject);

export const ToyProjectSchema = ToyProjectBaseSchema.pipe(
  Project.validate<ToyWorkspaceValue>("toy deck references resolve", (workspace, issue) => {
    for (const diagnostic of validateToyWorkspaceValue(workspace)) {
      issue.at(diagnostic.documentPath ?? "toy", diagnostic.message, diagnostic.path);
    }
  }),
);
