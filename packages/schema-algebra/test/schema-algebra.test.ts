import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import {
  Relation,
  RelationAnnotationKey,
  buildRelationGraph,
  getRelationAnnotation,
  validateRelations,
} from "../src";

const Field = Schema.Struct({
  id: Relation.id("Field", { scope: Relation.parent("Form") }),
  label: Schema.String,
});

const Form = Schema.Struct({
  id: Relation.id("Form", { display: "title" }),
  title: Schema.String,
  fields: Schema.Array(Field),
});

const Policy = Schema.Struct({
  id: Relation.id("Policy"),
  formId: Relation.ref("Form"),
  requiredFieldIds: Relation.refs("Field", { scopedBy: "formId" }),
});

const Workspace = Schema.Struct({
  forms: Schema.Array(Form),
  policies: Schema.Array(Policy),
});

describe("schema-algebra", () => {
  it("stores relation metadata as Effect Schema annotations", () => {
    const annotation = getRelationAnnotation(Relation.ref("Form").ast);

    expect(annotation).toEqual({
      kind: "ref",
      target: "Form",
      scopedBy: undefined,
      scope: undefined,
    });
    expect(Relation.ref("Form").ast.annotations[RelationAnnotationKey]).toEqual(annotation);
  });

  it("builds a definition and reference graph from a schema and value", () => {
    const graph = buildRelationGraph(Workspace, validWorkspace);

    expect(
      graph.definitions.map((definition) => ({
        type: definition.type,
        id: definition.id,
        scope: definition.scope,
        path: definition.path,
        display: definition.display,
      })),
    ).toEqual([
      {
        type: "Form",
        id: "intake",
        scope: undefined,
        path: ["forms", "0", "id"],
        display: "Intake",
      },
      {
        type: "Field",
        id: "name",
        scope: "intake",
        path: ["forms", "0", "fields", "0", "id"],
        display: undefined,
      },
      {
        type: "Field",
        id: "signature",
        scope: "intake",
        path: ["forms", "0", "fields", "1", "id"],
        display: undefined,
      },
      {
        type: "Policy",
        id: "required-fields",
        scope: undefined,
        path: ["policies", "0", "id"],
        display: undefined,
      },
    ]);

    expect(graph.references).toEqual([
      {
        target: "Form",
        id: "intake",
        path: ["policies", "0", "formId"],
        scope: undefined,
        scopedBy: undefined,
      },
      {
        target: "Field",
        id: "name",
        path: ["policies", "0", "requiredFieldIds", "0"],
        scope: "intake",
        scopedBy: ["formId"],
      },
      {
        target: "Field",
        id: "signature",
        path: ["policies", "0", "requiredFieldIds", "1"],
        scope: "intake",
        scopedBy: ["formId"],
      },
    ]);
  });

  it("validates global references and scoped references without top-level custom code", () => {
    expect(validateRelations(Workspace, validWorkspace)).toEqual([]);
    expect(Relation.validate(Workspace, validWorkspace)).toEqual([]);

    expect(
      validateRelations(Workspace, {
        ...validWorkspace,
        policies: [
          {
            id: "required-fields",
            formId: "intake",
            requiredFieldIds: ["name", "missing"],
          },
        ],
      }).map((diagnostic) => ({
        code: diagnostic.code,
        path: diagnostic.path,
        message: diagnostic.message,
      })),
    ).toEqual([
      {
        code: "unresolved-ref",
        path: ["policies", "0", "requiredFieldIds", "1"],
        message: 'Unresolved Field reference "missing" in scope "intake"',
      },
    ]);
  });

  it("reports duplicate IDs within the same relation scope", () => {
    const diagnostics = validateRelations(Workspace, {
      forms: [
        {
          id: "intake",
          title: "Intake",
          fields: [
            { id: "name", label: "Name" },
            { id: "name", label: "Legal Name" },
          ],
        },
      ],
      policies: [],
    });

    expect(
      diagnostics.map((diagnostic) => ({
        code: diagnostic.code,
        path: diagnostic.path,
        message: diagnostic.message,
      })),
    ).toEqual([
      {
        code: "duplicate-id",
        path: ["forms", "0", "fields", "0", "id"],
        message: 'Duplicate Field id "name" in scope "intake"',
      },
      {
        code: "duplicate-id",
        path: ["forms", "0", "fields", "1", "id"],
        message: 'Duplicate Field id "name" in scope "intake"',
      },
    ]);
  });

  it("exposes graph and validation helpers under the Relation namespace", () => {
    expect(Relation.graph(Workspace, validWorkspace)).toEqual(
      buildRelationGraph(Workspace, validWorkspace),
    );
  });
});

const validWorkspace = {
  forms: [
    {
      id: "intake",
      title: "Intake",
      fields: [
        { id: "name", label: "Name" },
        { id: "signature", label: "Signature" },
      ],
    },
  ],
  policies: [
    {
      id: "required-fields",
      formId: "intake",
      requiredFieldIds: ["name", "signature"],
    },
  ],
};
