import type { SchematicsReflection, SourceFile } from "@schematics/core";
import type {
  ArtifactRef,
  ArtifactProjectChangeProvenance,
  GetArtifactCapabilitiesResponse,
  ListArtifactRefsResponse,
  ReadArtifactViewRequest,
  ReadArtifactViewResponse,
} from "@schematics/protocol";

export interface SchematicsChatModel {
  readonly id: string;
  readonly label: string;
}

export interface SchematicsChatMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly model?: string | undefined;
}

export interface SchematicsToolCall {
  readonly id: string;
  readonly name: string;
  readonly args: Record<string, unknown>;
  readonly result?: unknown;
  readonly status: "pending" | "success" | "error";
}

export interface SchematicsChatTurnInput {
  readonly turnId?: string | undefined;
  readonly message: string;
  readonly history: readonly SchematicsChatMessage[];
  readonly reflection: SchematicsReflection;
  readonly tools: SchematicsHostRuntime;
  readonly model?: string | undefined;
  readonly planMode?: boolean | undefined;
  readonly onText?: ((text: string) => void) | undefined;
  readonly onToolCall?: ((toolCall: SchematicsToolCall) => void) | undefined;
}

export interface SchematicsChatHandle {
  readonly promise: Promise<SchematicsChatResult>;
  readonly cancel: () => void;
}

export interface SchematicsChatResult {
  readonly message: SchematicsChatMessage;
}

export interface SchematicsChatAdapter {
  readonly models?: readonly SchematicsChatModel[] | undefined;
  readonly defaultModel?: string | undefined;
  readonly send: (input: SchematicsChatTurnInput) => SchematicsChatHandle;
}

export interface SchematicsFileEdit {
  readonly path: string;
  readonly content: string;
  readonly create?: boolean | undefined;
}

export interface SchematicsPatchProposal {
  readonly id: string;
  readonly label: string;
  readonly edits: readonly SchematicsFileEdit[];
  readonly files: readonly SourceFile[];
  readonly validation: SchematicsReflection["validationSummary"];
  readonly diagnostics: SchematicsReflection["diagnostics"];
}

export interface SchematicsMutationOptions {
  readonly provenance?: ArtifactProjectChangeProvenance | undefined;
}

export interface SchematicsHostRuntime {
  readonly readFile: (path: string) => SourceFile | null | Promise<SourceFile | null>;
  readonly listFiles: () => readonly string[] | Promise<readonly string[]>;
  readonly searchFiles: (
    query: string,
  ) =>
    | readonly { path: string; line: number; content: string }[]
    | Promise<readonly { path: string; line: number; content: string }[]>;
  readonly writeFile: (
    file: SourceFile,
    options?: SchematicsMutationOptions,
  ) => void | Promise<void>;
  readonly createFile: (
    file: SourceFile,
    options?: SchematicsMutationOptions,
  ) => void | Promise<void>;
  readonly deleteFile: (path: string, options?: SchematicsMutationOptions) => void | Promise<void>;
  readonly renameFile: (
    fromPath: string,
    toPath: string,
    options?: SchematicsMutationOptions,
  ) => void | Promise<void>;
  readonly applyEdits: (
    edits: readonly SchematicsFileEdit[],
    options?: { readonly validate?: boolean | undefined } & SchematicsMutationOptions,
  ) =>
    | {
        readonly changedPaths: readonly string[];
        readonly validation: SchematicsReflection["validationSummary"];
      }
    | Promise<{
        readonly changedPaths: readonly string[];
        readonly validation: SchematicsReflection["validationSummary"];
      }>;
  readonly proposePatch: (
    label: string,
    edits: readonly SchematicsFileEdit[],
  ) => SchematicsPatchProposal | Promise<SchematicsPatchProposal>;
  readonly validateWorkspace: () => SchematicsReflection | Promise<SchematicsReflection>;
  readonly getSchema: () =>
    | SchematicsReflection["schemas"]
    | Promise<SchematicsReflection["schemas"]>;
  readonly getJsonSchema: (schemaId?: string | null) => unknown | Promise<unknown>;
  readonly getDiagnostics: () =>
    | SchematicsReflection["diagnostics"]
    | Promise<SchematicsReflection["diagnostics"]>;
  readonly listArtifacts?:
    | (() => ListArtifactRefsResponse | Promise<ListArtifactRefsResponse>)
    | undefined;
  readonly getArtifactCapabilities?:
    | ((
        ref: ArtifactRef,
      ) => GetArtifactCapabilitiesResponse | Promise<GetArtifactCapabilitiesResponse>)
    | undefined;
  readonly readArtifactView?:
    | ((
        request: ReadArtifactViewRequest,
      ) => ReadArtifactViewResponse | Promise<ReadArtifactViewResponse>)
    | undefined;
  readonly writeArtifactSource?:
    | ((
        ref: Extract<ArtifactRef, { readonly _tag: "ProjectFile" }>,
        content: string,
        options?: SchematicsMutationOptions,
      ) =>
        | {
            readonly changedPaths: readonly string[];
            readonly validation: SchematicsReflection["validationSummary"];
          }
        | Promise<{
            readonly changedPaths: readonly string[];
            readonly validation: SchematicsReflection["validationSummary"];
          }>)
    | undefined;
}
