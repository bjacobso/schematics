import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import {
  Relation,
  RelationAnnotationKey,
  buildRelationGraph,
  buildEntityIndex,
  definitionLocations,
  getRelationAnnotation,
  patchSuggestions,
  referenceDiagnostics,
  references,
  validateRelationReferences,
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

describe("algebra", () => {
  it("stores relation metadata as Effect Schema annotations", () => {
    const annotation = getRelationAnnotation(Relation.ref("Form").ast);

    expect(annotation).toEqual({
      kind: "ref",
      target: "Form",
      scopedBy: undefined,
      scope: undefined,
      edge: undefined,
      valueKind: "id",
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
        edge: undefined,
        valueKind: "id",
      },
      {
        target: "Field",
        id: "name",
        path: ["policies", "0", "requiredFieldIds", "0"],
        scope: "intake",
        scopedBy: ["formId"],
        edge: undefined,
        valueKind: "id",
      },
      {
        target: "Field",
        id: "signature",
        path: ["policies", "0", "requiredFieldIds", "1"],
        scope: "intake",
        scopedBy: ["formId"],
        edge: undefined,
        valueKind: "id",
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

  it("derives artifact-friendly relation inspection views from a graph", () => {
    const graph = buildRelationGraph(Workspace, validWorkspace);

    expect(buildEntityIndex(graph)).toEqual([
      {
        type: "Form",
        id: "intake",
        scope: undefined,
        definitions: [graph.definitions[0]],
      },
      {
        type: "Field",
        id: "name",
        scope: "intake",
        definitions: [graph.definitions[1]],
      },
      {
        type: "Field",
        id: "signature",
        scope: "intake",
        definitions: [graph.definitions[2]],
      },
      {
        type: "Policy",
        id: "required-fields",
        scope: undefined,
        definitions: [graph.definitions[3]],
      },
    ]);
    expect(definitionLocations(graph)).toBe(graph.definitions);
    expect(references(graph)).toBe(graph.references);

    const diagnostics = validateRelations(Workspace, {
      ...validWorkspace,
      policies: [
        {
          id: "required-fields",
          formId: "missing",
          requiredFieldIds: ["name"],
        },
      ],
    });
    expect(referenceDiagnostics(diagnostics)).toEqual([
      expect.objectContaining({
        code: "unresolved-ref",
        path: ["policies", "0", "formId"],
      }),
      expect.objectContaining({
        code: "unresolved-ref",
        path: ["policies", "0", "requiredFieldIds", "0"],
      }),
    ]);
    expect(patchSuggestions(diagnostics)).toEqual([
      {
        kind: "create-definition",
        target: "Form",
        id: "missing",
        path: ["policies", "0", "formId"],
        message: 'Create Form "missing"',
        reference: expect.objectContaining({
          target: "Form",
          id: "missing",
          path: ["policies", "0", "formId"],
        }),
      },
      {
        kind: "create-definition",
        target: "Field",
        id: "name",
        scope: "missing",
        path: ["policies", "0", "requiredFieldIds", "0"],
        message: 'Create Field "name"',
        reference: expect.objectContaining({
          target: "Field",
          id: "name",
          scope: "missing",
          path: ["policies", "0", "requiredFieldIds", "0"],
        }),
      },
    ]);
    expect(Relation.entityIndex(graph)).toEqual(buildEntityIndex(graph));
    expect(Relation.definitionLocations(graph)).toBe(graph.definitions);
    expect(Relation.references(graph)).toBe(graph.references);
    expect(Relation.referenceDiagnostics(diagnostics)).toEqual(referenceDiagnostics(diagnostics));
    expect(Relation.patchSuggestions(diagnostics)).toEqual(patchSuggestions(diagnostics));
  });

  it("validates extracted references against a relation entity index", () => {
    const graph = buildRelationGraph(Workspace, validWorkspace);
    const entityIndex = buildEntityIndex(graph);

    expect(
      validateRelationReferences(entityIndex, [
        {
          target: "Field",
          id: "signature",
          scope: "intake",
          path: ["rules", "0", "fact"],
          valueKind: "path",
        },
      ]),
    ).toEqual([]);

    expect(
      validateRelationReferences(entityIndex, [
        {
          target: "Field",
          id: "missing",
          scope: "intake",
          path: ["rules", "1", "fact"],
          valueKind: "path",
        },
      ]),
    ).toEqual([
      expect.objectContaining({
        code: "unresolved-ref",
        path: ["rules", "1", "fact"],
        message: 'Unresolved Field reference "missing" in scope "intake"',
      }),
    ]);
    expect(
      Relation.validateRelationReferences(entityIndex, [
        {
          target: "Form",
          id: "missing",
          path: ["rules", "2", "value"],
          valueKind: "id",
        },
      ]),
    ).toEqual([
      expect.objectContaining({
        code: "unresolved-ref",
        path: ["rules", "2", "value"],
      }),
    ]);
  });

  it("derives definitions from object values and validates path refs with typed edges", () => {
    const FieldPath = Relation.derivedId(
      Schema.Struct({
        path: Schema.String,
        label: Schema.String,
      }),
      "FieldPath",
      { id: "path", scope: Relation.parent("Form"), display: "label" },
    );
    const FormWithPaths = Schema.Struct({
      id: Relation.id("Form"),
      fields: Schema.Array(FieldPath),
    });
    const MappingEntry = Schema.Struct({
      field: Relation.pathRef("FieldPath", {
        scopedBy: "../form",
        edge: "maps_field",
      }),
    });
    const Mapping = Schema.Struct({
      form: Relation.ref("Form", { edge: "maps_form" }),
      entries: Schema.Array(MappingEntry),
    });
    const WorkspaceWithMappings = Schema.Struct({
      forms: Schema.Array(FormWithPaths),
      mappings: Schema.Array(Mapping),
    });

    const graph = buildRelationGraph(WorkspaceWithMappings, {
      forms: [
        {
          id: "intake",
          fields: [{ path: "form.signature", label: "Signature" }],
        },
      ],
      mappings: [
        {
          form: "intake",
          entries: [{ field: "form.signature" }],
        },
      ],
    });

    expect(graph.definitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "FieldPath",
          id: "form.signature",
          scope: "intake",
          path: ["forms", "0", "fields", "0", "path"],
          display: "Signature",
          derived: true,
        }),
      ]),
    );
    expect(graph.references).toEqual(
      expect.arrayContaining([
        {
          target: "FieldPath",
          id: "form.signature",
          path: ["mappings", "0", "entries", "0", "field"],
          scope: "intake",
          scopedBy: ["..", "form"],
          edge: "maps_field",
          valueKind: "path",
        },
      ]),
    );
    expect(
      validateRelations(WorkspaceWithMappings, {
        forms: [
          {
            id: "intake",
            fields: [{ path: "form.signature", label: "Signature" }],
          },
        ],
        mappings: [
          {
            form: "intake",
            entries: [{ field: "form.missing" }],
          },
        ],
      }),
    ).toEqual([
      expect.objectContaining({
        code: "unresolved-ref",
        path: ["mappings", "0", "entries", "0", "field"],
        message: 'Unresolved FieldPath reference "form.missing" in scope "intake"',
      }),
    ]);
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
