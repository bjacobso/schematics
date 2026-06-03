import { Effect, Schema } from "effect";
import { Tool, Toolkit } from "effect/unstable/ai";
import type { SchematicsReflection } from "@schematics/core";
import type { ArtifactRef } from "@schematics/protocol";
import { ToolFailure, ValidationSummary } from "./common-toolkit-schemas";
import { FileEdit, MultiEditResult, MutationResult } from "./workspace-schemas";
import {
  SchematicsWorkspace,
  toolFailure,
  type SchematicsArtifactProjectService,
} from "./schematics-workspace";

export const ListFilesTool = Tool.make("list_files", {
  description: "List all in-memory files in the Schematics workspace.",
  success: Schema.Struct({
    files: Schema.Array(Schema.String),
    count: Schema.Number,
  }),
  failure: ToolFailure,
  failureMode: "return",
});

export const ReadFileTool = Tool.make("read_file", {
  description: "Read one in-memory file by path.",
  parameters: Schema.Struct({
    path: Schema.String.annotate({ description: "Path of the file to read." }),
  }),
  success: Schema.Struct({
    path: Schema.String,
    content: Schema.String,
  }),
  failure: ToolFailure,
  failureMode: "return",
});

export const GrepFilesTool = Tool.make("grep_files", {
  description:
    "Search all in-memory files for a literal string and return matching lines with paths and line numbers.",
  parameters: Schema.Struct({
    query: Schema.String.annotate({ description: "Literal text to search for." }),
  }),
  success: Schema.Struct({
    matches: Schema.Array(
      Schema.Struct({
        path: Schema.String,
        line: Schema.Number,
        content: Schema.String,
      }),
    ),
    count: Schema.Number,
  }),
  failure: ToolFailure,
  failureMode: "return",
});

export const CreateFileTool = Tool.make("create_file", {
  description: "Create a new in-memory file. Fails if the path already exists.",
  parameters: Schema.Struct({
    path: Schema.String.annotate({ description: "Path for the new file." }),
    content: Schema.String.annotate({ description: "Complete file content." }),
  }),
  success: MutationResult,
  failure: ToolFailure,
  failureMode: "return",
});

export const WriteFileTool = Tool.make("write_file", {
  description:
    "Replace the complete content of an existing in-memory file. Use create_file for new files.",
  parameters: Schema.Struct({
    path: Schema.String.annotate({ description: "Path of the file to replace." }),
    content: Schema.String.annotate({ description: "Complete replacement file content." }),
  }),
  success: MutationResult,
  failure: ToolFailure,
  failureMode: "return",
});

export const ReplaceFileContentTool = Tool.make("replace_file_content", {
  description:
    "Replace a literal text span inside an existing in-memory file. Use this for focused edits.",
  parameters: Schema.Struct({
    path: Schema.String.annotate({ description: "Path of the file to edit." }),
    search: Schema.String.annotate({ description: "Exact text to replace." }),
    replace: Schema.String.annotate({ description: "Replacement text." }),
    replaceAll: Schema.optional(
      Schema.Boolean.annotate({
        description: "When true, replace every occurrence. Defaults to false.",
      }),
    ),
  }),
  success: MutationResult,
  failure: ToolFailure,
  failureMode: "return",
});

export const ValidateWorkspaceTool = Tool.make("validate_workspace", {
  description: "Validate the current in-memory files with the active Effect Schema.",
  success: Schema.Struct({
    summary: ValidationSummary,
    diagnostics: Schema.Array(Schema.Unknown),
    routeMatches: Schema.Array(Schema.Unknown),
  }),
  failure: ToolFailure,
  failureMode: "return",
});

export const GetJsonSchemaTool = Tool.make("get_json_schema", {
  description:
    "Return the generated JSON Schema for the active file or for a specific schema route id.",
  parameters: Schema.Struct({
    schemaId: Schema.optional(
      Schema.String.annotate({
        description: "Optional schema route id. Omit to get the active file schema.",
      }),
    ),
  }),
  success: Schema.Struct({
    schema: Schema.Unknown,
  }),
  failure: ToolFailure,
  failureMode: "return",
});

export const GetDiagnosticsTool = Tool.make("get_diagnostics", {
  description: "Return the current structured diagnostics without mutating files.",
  success: Schema.Struct({
    diagnostics: Schema.Array(Schema.Unknown),
    validation: ValidationSummary,
  }),
  failure: ToolFailure,
  failureMode: "return",
});

export const ApplyEditsTool = Tool.make("apply_edits", {
  description:
    "Atomically apply complete-file edits. The whole batch is rejected if validation fails.",
  parameters: Schema.Struct({
    edits: Schema.Array(FileEdit),
    validate: Schema.optional(
      Schema.Boolean.annotate({
        description: "Validate before committing. Defaults to true.",
      }),
    ),
  }),
  success: MultiEditResult,
  failure: ToolFailure,
  failureMode: "return",
});

export const ProposePatchTool = Tool.make("propose_patch", {
  description:
    "Prepare a multi-file patch for user approval without mutating the workspace. Use this in plan mode.",
  parameters: Schema.Struct({
    label: Schema.String.annotate({ description: "Short human-readable proposal label." }),
    edits: Schema.Array(FileEdit),
  }),
  success: Schema.Struct({
    id: Schema.String,
    label: Schema.String,
    changedPaths: Schema.Array(Schema.String),
    validation: ValidationSummary,
    diagnostics: Schema.Array(Schema.Unknown),
  }),
  failure: ToolFailure,
  failureMode: "return",
});

export const BaseWorkspaceToolkit = Toolkit.make(
  ListFilesTool,
  ReadFileTool,
  GrepFilesTool,
  CreateFileTool,
  WriteFileTool,
  ReplaceFileContentTool,
  ValidateWorkspaceTool,
  GetJsonSchemaTool,
  GetDiagnosticsTool,
  ApplyEditsTool,
  ProposePatchTool,
);

export const BaseWorkspaceToolkitLayer = BaseWorkspaceToolkit.toLayer(
  Effect.gen(function* () {
    const workspace = yield* SchematicsWorkspace;
    return BaseWorkspaceToolkit.of({
      list_files: Effect.fn("BaseWorkspaceToolkit.list_files")(function* () {
        const artifacts = yield* workspace.listArtifacts;
        const files = artifactFilePaths(artifacts.artifacts);
        return { files, count: files.length };
      }),
      read_file: Effect.fn("BaseWorkspaceToolkit.read_file")(function* ({ path }) {
        return yield* readFileSource(workspace, path);
      }),
      grep_files: Effect.fn("BaseWorkspaceToolkit.grep_files")(function* ({ query }) {
        const artifacts = yield* workspace.listArtifacts;
        const matches: { path: string; line: number; content: string }[] = [];
        for (const path of artifactFilePaths(artifacts.artifacts)) {
          const file = yield* readFileSource(workspace, path);
          matches.push(
            ...file.content
              .split(/\r?\n/)
              .map((line, index) => ({ path, line: index + 1, content: line }))
              .filter((line) => line.content.includes(query)),
          );
        }
        return { matches, count: matches.length };
      }),
      create_file: Effect.fn("BaseWorkspaceToolkit.create_file")(function* ({ path, content }) {
        const artifacts = yield* workspace.listArtifacts;
        if (artifactFilePaths(artifacts.artifacts).includes(path)) {
          return yield* Effect.fail(toolFailure(`File already exists: ${path}`));
        }
        return yield* workspace.writeArtifactSource(projectFileRef(path), content);
      }),
      write_file: Effect.fn("BaseWorkspaceToolkit.write_file")(function* ({ path, content }) {
        yield* readFileSource(workspace, path);
        return yield* workspace.writeArtifactSource(projectFileRef(path), content);
      }),
      replace_file_content: Effect.fn("BaseWorkspaceToolkit.replace_file_content")(function* ({
        path,
        search,
        replace,
        replaceAll,
      }) {
        const file = yield* readFileSource(workspace, path);
        if (!file.content.includes(search)) {
          return yield* Effect.fail(toolFailure(`Search text not found in ${path}`));
        }

        const content =
          replaceAll === true
            ? file.content.split(search).join(replace)
            : file.content.replace(search, replace);
        return yield* workspace.writeArtifactSource(projectFileRef(path), content);
      }),
      validate_workspace: Effect.fn("BaseWorkspaceToolkit.validate_workspace")(function* () {
        const summary = yield* readArtifactValue<typeof ValidationSummary.Type>(
          workspace,
          workspaceRef,
          "validationSummary",
        );
        const diagnostics = yield* readArtifactValue<unknown[]>(
          workspace,
          workspaceRef,
          "diagnostics",
        );
        const routeMatches = yield* readArtifactValue<unknown[]>(
          workspace,
          workspaceRef,
          "routeMatches",
        );
        return {
          summary,
          diagnostics: Array.isArray(diagnostics) ? diagnostics : [],
          routeMatches: Array.isArray(routeMatches) ? routeMatches : [],
        };
      }),
      get_json_schema: Effect.fn("BaseWorkspaceToolkit.get_json_schema")(function* ({ schemaId }) {
        const reflection = yield* readReflection(workspace);
        if (!schemaId) return { schema: reflection.activeJsonSchema };
        return {
          schema: reflection.schemas.find((schema) => schema.id === schemaId)?.jsonSchema ?? null,
        };
      }),
      get_diagnostics: Effect.fn("BaseWorkspaceToolkit.get_diagnostics")(function* () {
        const diagnostics = yield* readArtifactValue<unknown[]>(
          workspace,
          workspaceRef,
          "diagnostics",
        );
        const validation = yield* readArtifactValue<typeof ValidationSummary.Type>(
          workspace,
          workspaceRef,
          "validationSummary",
        );
        return {
          diagnostics: Array.isArray(diagnostics) ? diagnostics : [],
          validation,
        };
      }),
      apply_edits: Effect.fn("BaseWorkspaceToolkit.apply_edits")(function* ({ edits, validate }) {
        const result = yield* workspace.applyEdits(edits, { validate });
        return { success: true, ...result };
      }),
      propose_patch: Effect.fn("BaseWorkspaceToolkit.propose_patch")(function* ({ label, edits }) {
        const proposal = yield* workspace.proposePatch(label, edits);
        return {
          id: proposal.id,
          label: proposal.label,
          changedPaths: proposal.edits.map((edit) => edit.path),
          validation: proposal.validation,
          diagnostics: Array.from(proposal.diagnostics),
        };
      }),
    });
  }),
);

const workspaceRef = { _tag: "Project" as const };

function projectFileRef(path: string): Extract<ArtifactRef, { readonly _tag: "ProjectFile" }> {
  return { _tag: "ProjectFile", path };
}

function artifactFilePaths(artifacts: readonly ArtifactRef[]): string[] {
  return artifacts.flatMap((ref) => (ref._tag === "ProjectFile" ? [ref.path] : []));
}

function readArtifactValue<T>(
  workspace: SchematicsArtifactProjectService,
  ref: ArtifactRef,
  view: string,
) {
  return workspace
    .readArtifactView({ ref, view })
    .pipe(Effect.map((response) => response.value as T));
}

function readFileSource(workspace: SchematicsArtifactProjectService, path: string) {
  return readArtifactValue<unknown>(workspace, projectFileRef(path), "sourceText").pipe(
    Effect.flatMap((value) =>
      typeof value === "string"
        ? Effect.succeed({ path, content: value })
        : Effect.fail(toolFailure(`sourceText view for ${path} did not return text`)),
    ),
  );
}

function readReflection(workspace: SchematicsArtifactProjectService) {
  return readArtifactValue<unknown>(workspace, workspaceRef, "reflection").pipe(
    Effect.flatMap((value) =>
      isReflection(value)
        ? Effect.succeed(value)
        : Effect.fail(toolFailure("reflection artifact view did not return workspace reflection")),
    ),
  );
}

function isReflection(value: unknown): value is SchematicsReflection {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<SchematicsReflection>;
  return Array.isArray(candidate.schemas) && "activeJsonSchema" in candidate;
}
