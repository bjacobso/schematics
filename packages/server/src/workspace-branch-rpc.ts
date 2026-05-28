import { Effect } from "effect";
import {
  SchemaIdeWorkspaceBranchRpcGroup,
  toWorkspaceRpcError,
  type SchemaIdeWorkspaceBranchService,
} from "@schema-ide/protocol";

export const makeSchemaIdeWorkspaceBranchRpcHandlers = (
  branches: SchemaIdeWorkspaceBranchService,
) =>
  SchemaIdeWorkspaceBranchRpcGroup.of({
    ListBranches: () => branches.listBranches.pipe(Effect.mapError(toWorkspaceRpcError)),
    CreateBranch: (request) =>
      branches.createBranch(request).pipe(Effect.mapError(toWorkspaceRpcError)),
    GetBranch: (request) => branches.getBranch(request).pipe(Effect.mapError(toWorkspaceRpcError)),
    CompareBranch: (request) =>
      branches.compareBranch(request).pipe(Effect.mapError(toWorkspaceRpcError)),
    MergeBranch: (request) =>
      branches.mergeBranch(request).pipe(Effect.mapError(toWorkspaceRpcError)),
    DeleteBranch: (request) =>
      branches.deleteBranch(request).pipe(Effect.mapError(toWorkspaceRpcError)),
    ArchiveBranch: (request) =>
      branches.archiveBranch(request).pipe(Effect.mapError(toWorkspaceRpcError)),
  });

export const makeSchemaIdeWorkspaceBranchRpcLayer = (branches: SchemaIdeWorkspaceBranchService) =>
  SchemaIdeWorkspaceBranchRpcGroup.toLayer(makeSchemaIdeWorkspaceBranchRpcHandlers(branches));
