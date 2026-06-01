import type { SchemaIdeReflection, SourceFile } from "@schema-ide/core";
import type {
  ArtifactRef,
  GetArtifactCapabilitiesResponse,
  ListArtifactRefsResponse,
  ReadArtifactViewRequest,
  ReadArtifactViewResponse,
} from "@schema-ide/protocol";

export interface SchemaIdeChatModel {
  readonly id: string;
  readonly label: string;
}

export interface SchemaIdeChatMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly model?: string | undefined;
}

export interface SchemaIdeToolCall {
  readonly id: string;
  readonly name: string;
  readonly args: Record<string, unknown>;
  readonly result?: unknown;
  readonly status: "pending" | "success" | "error";
}

export interface SchemaIdeChatTurnInput {
  readonly message: string;
  readonly history: readonly SchemaIdeChatMessage[];
  readonly reflection: SchemaIdeReflection;
  readonly tools: SchemaIdeHostRuntime;
  readonly model?: string | undefined;
  readonly planMode?: boolean | undefined;
  readonly onText?: ((text: string) => void) | undefined;
  readonly onToolCall?: ((toolCall: SchemaIdeToolCall) => void) | undefined;
}

export interface SchemaIdeChatHandle {
  readonly promise: Promise<SchemaIdeChatResult>;
  readonly cancel: () => void;
}

export interface SchemaIdeChatResult {
  readonly message: SchemaIdeChatMessage;
}

export interface SchemaIdeChatAdapter {
  readonly models?: readonly SchemaIdeChatModel[] | undefined;
  readonly defaultModel?: string | undefined;
  readonly send: (input: SchemaIdeChatTurnInput) => SchemaIdeChatHandle;
}

export interface SchemaIdeFileEdit {
  readonly path: string;
  readonly content: string;
  readonly create?: boolean | undefined;
}

export interface SchemaIdePatchProposal {
  readonly id: string;
  readonly label: string;
  readonly edits: readonly SchemaIdeFileEdit[];
  readonly files: readonly SourceFile[];
  readonly validation: SchemaIdeReflection["validationSummary"];
  readonly diagnostics: SchemaIdeReflection["diagnostics"];
}

export interface SchemaIdeHostRuntime {
  readonly readFile: (path: string) => SourceFile | null | Promise<SourceFile | null>;
  readonly listFiles: () => readonly string[] | Promise<readonly string[]>;
  readonly searchFiles: (
    query: string,
  ) =>
    | readonly { path: string; line: number; content: string }[]
    | Promise<readonly { path: string; line: number; content: string }[]>;
  readonly writeFile: (file: SourceFile) => void | Promise<void>;
  readonly createFile: (file: SourceFile) => void | Promise<void>;
  readonly deleteFile: (path: string) => void | Promise<void>;
  readonly renameFile: (fromPath: string, toPath: string) => void | Promise<void>;
  readonly applyEdits: (
    edits: readonly SchemaIdeFileEdit[],
    options?: { readonly validate?: boolean | undefined },
  ) =>
    | {
        readonly changedPaths: readonly string[];
        readonly validation: SchemaIdeReflection["validationSummary"];
      }
    | Promise<{
        readonly changedPaths: readonly string[];
        readonly validation: SchemaIdeReflection["validationSummary"];
      }>;
  readonly proposePatch: (
    label: string,
    edits: readonly SchemaIdeFileEdit[],
  ) => SchemaIdePatchProposal | Promise<SchemaIdePatchProposal>;
  readonly validateWorkspace: () => SchemaIdeReflection | Promise<SchemaIdeReflection>;
  readonly getSchema: () =>
    | SchemaIdeReflection["schemas"]
    | Promise<SchemaIdeReflection["schemas"]>;
  readonly getJsonSchema: (schemaId?: string | null) => unknown | Promise<unknown>;
  readonly getDiagnostics: () =>
    | SchemaIdeReflection["diagnostics"]
    | Promise<SchemaIdeReflection["diagnostics"]>;
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
        ref: Extract<ArtifactRef, { readonly _tag: "WorkspaceFile" }>,
        content: string,
      ) =>
        | {
            readonly changedPaths: readonly string[];
            readonly validation: SchemaIdeReflection["validationSummary"];
          }
        | Promise<{
            readonly changedPaths: readonly string[];
            readonly validation: SchemaIdeReflection["validationSummary"];
          }>)
    | undefined;
}
