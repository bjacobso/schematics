import { Effect, Schema } from "effect";
import { Tool, Toolkit } from "effect/unstable/ai";
import { ToolFailure, ValidationSummary } from "./common-toolkit-schemas";
import { FileEdit, MultiEditResult, MutationResult } from "./workspace-schemas";
import { SchemaIdeWorkspace, toolFailure } from "./schema-ide-workspace";

export const ListFilesTool = Tool.make("list_files", {
  description: "List all in-memory files in the Schema IDE workspace.",
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
    const workspace = yield* SchemaIdeWorkspace;
    return BaseWorkspaceToolkit.of({
      list_files: Effect.fn("BaseWorkspaceToolkit.list_files")(function* () {
        const files = Array.from(yield* workspace.listFiles);
        return { files, count: files.length };
      }),
      read_file: Effect.fn("BaseWorkspaceToolkit.read_file")(function* ({ path }) {
        return yield* workspace.readFile(path);
      }),
      grep_files: Effect.fn("BaseWorkspaceToolkit.grep_files")(function* ({ query }) {
        const matches = Array.from(yield* workspace.searchFiles(query));
        return { matches, count: matches.length };
      }),
      create_file: Effect.fn("BaseWorkspaceToolkit.create_file")(function* ({ path, content }) {
        yield* workspace.createFile({ path, content });
        const reflection = yield* workspace.validateWorkspace;
        return { success: true, path, validation: reflection.validationSummary };
      }),
      write_file: Effect.fn("BaseWorkspaceToolkit.write_file")(function* ({ path, content }) {
        yield* workspace.readFile(path);
        yield* workspace.writeFile({ path, content });
        const reflection = yield* workspace.validateWorkspace;
        return { success: true, path, validation: reflection.validationSummary };
      }),
      replace_file_content: Effect.fn("BaseWorkspaceToolkit.replace_file_content")(function* ({
        path,
        search,
        replace,
        replaceAll,
      }) {
        const file = yield* workspace.readFile(path);
        if (!file.content.includes(search)) {
          return yield* Effect.fail(toolFailure(`Search text not found in ${path}`));
        }

        const content =
          replaceAll === true
            ? file.content.split(search).join(replace)
            : file.content.replace(search, replace);
        yield* workspace.writeFile({ path, content });
        const reflection = yield* workspace.validateWorkspace;
        return { success: true, path, validation: reflection.validationSummary };
      }),
      validate_workspace: Effect.fn("BaseWorkspaceToolkit.validate_workspace")(function* () {
        const reflection = yield* workspace.validateWorkspace;
        return {
          summary: reflection.validationSummary,
          diagnostics: Array.from(reflection.diagnostics),
          routeMatches: Array.from(reflection.routeMatches),
        };
      }),
      get_json_schema: Effect.fn("BaseWorkspaceToolkit.get_json_schema")(function* ({ schemaId }) {
        return { schema: yield* workspace.getJsonSchema(schemaId ?? null) };
      }),
      get_diagnostics: Effect.fn("BaseWorkspaceToolkit.get_diagnostics")(function* () {
        const reflection = yield* workspace.validateWorkspace;
        return {
          diagnostics: Array.from(reflection.diagnostics),
          validation: reflection.validationSummary,
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
