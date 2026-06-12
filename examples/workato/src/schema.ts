import { Relation } from "@schematics/algebra";
import { Schema } from "effect";

export const FOLDER_KIND = "folder";
export const CONNECTION_KIND = "connection";
export const LOOKUP_TABLE_KIND = "lookupTable";
export const PROPERTIES_KIND = "properties";
export const RECIPE_KIND = "recipe";

export const WORKATO_ADAPTERS = [
  "salesforce",
  "netsuite",
  "slack",
  "jira",
  "workday",
  "http",
  "workato",
] as const;
export const AdapterSchema = Schema.Literals(WORKATO_ADAPTERS);
export type Adapter = typeof AdapterSchema.Type;

export const FolderConfigSchema = Schema.Struct({
  id: Relation.id(FOLDER_KIND, { display: "name" }),
  name: Schema.String,
  parentId: Schema.optional(Relation.ref(FOLDER_KIND, { edge: "childOf" })),
});
export type FolderConfig = typeof FolderConfigSchema.Type;

export const ConnectionConfigSchema = Schema.Struct({
  id: Relation.id(CONNECTION_KIND, { display: "name" }),
  name: Schema.String,
  adapter: AdapterSchema,
  folderId: Schema.optional(Relation.ref(FOLDER_KIND, { edge: "livesIn" })),
});
export type ConnectionConfig = typeof ConnectionConfigSchema.Type;

export const LookupTableConfigSchema = Schema.Struct({
  id: Relation.id(LOOKUP_TABLE_KIND, { display: "name" }),
  name: Schema.String,
  columns: Schema.Array(Schema.String),
  rows: Schema.Array(Schema.Record(Schema.String, Schema.String)),
});
export type LookupTableConfig = typeof LookupTableConfigSchema.Type;

export const PropertiesConfigSchema = Schema.Struct({
  id: Relation.id(PROPERTIES_KIND, { display: "name" }),
  name: Schema.String,
  values: Schema.Record(Schema.String, Schema.String),
});
export type PropertiesConfig = typeof PropertiesConfigSchema.Type;

export const TriggerConfigSchema = Schema.Struct({
  adapter: AdapterSchema,
  event: Schema.String,
  connectionId: Schema.optional(Relation.ref(CONNECTION_KIND, { edge: "uses" })),
  input: Schema.optional(Schema.Record(Schema.String, Schema.String)),
});
export type TriggerConfig = typeof TriggerConfigSchema.Type;

// ── Recipe steps ─────────────────────────────────────────────────────────────
// A recursive discriminated union mirroring Workato's recipe step keywords:
// `action`, `lookup`, `if`, `foreach`, `handle_errors`, `call_recipe`, `stop`.
// Control-flow steps nest arbitrary step lists, so one YAML recipe can express
// branching, batched iteration, and monitored error handling at any depth.

export interface ActionStepConfig {
  readonly keyword: "action";
  readonly name: string;
  readonly adapter: Adapter;
  readonly operation: string;
  readonly connectionId: string;
  readonly input?: Readonly<Record<string, string>> | undefined;
  readonly comment?: string | undefined;
}

export interface LookupStepConfig {
  readonly keyword: "lookup";
  readonly name: string;
  readonly tableId: string;
  readonly match: Readonly<Record<string, string>>;
}

export interface IfStepConfig {
  readonly keyword: "if";
  readonly condition: string;
  readonly then: readonly StepConfig[];
  readonly else?: readonly StepConfig[] | undefined;
}

export interface ForeachStepConfig {
  readonly keyword: "foreach";
  readonly source: string;
  readonly batchSize?: number | undefined;
  readonly steps: readonly StepConfig[];
}

export interface HandleErrorsStepConfig {
  readonly keyword: "handle_errors";
  readonly retries?: number | undefined;
  readonly monitor: readonly StepConfig[];
  readonly rescue: readonly StepConfig[];
}

export interface CallRecipeStepConfig {
  readonly keyword: "call_recipe";
  readonly recipeId: string;
  readonly input?: Readonly<Record<string, string>> | undefined;
}

export interface StopStepConfig {
  readonly keyword: "stop";
  readonly reason?: string | undefined;
}

export type StepConfig =
  | ActionStepConfig
  | LookupStepConfig
  | IfStepConfig
  | ForeachStepConfig
  | HandleErrorsStepConfig
  | CallRecipeStepConfig
  | StopStepConfig;

const Steps = Schema.Array(Schema.suspend((): Schema.Schema<StepConfig> => StepConfigSchema));

export const ActionStepConfigSchema = Schema.Struct({
  keyword: Schema.Literal("action"),
  name: Schema.String,
  adapter: AdapterSchema,
  operation: Schema.String,
  connectionId: Relation.ref(CONNECTION_KIND, { edge: "uses" }),
  input: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  comment: Schema.optional(Schema.String),
});

export const LookupStepConfigSchema = Schema.Struct({
  keyword: Schema.Literal("lookup"),
  name: Schema.String,
  tableId: Relation.ref(LOOKUP_TABLE_KIND, { edge: "reads" }),
  match: Schema.Record(Schema.String, Schema.String),
});

export const IfStepConfigSchema = Schema.Struct({
  keyword: Schema.Literal("if"),
  condition: Schema.String,
  then: Steps,
  else: Schema.optional(Steps),
});

export const ForeachStepConfigSchema = Schema.Struct({
  keyword: Schema.Literal("foreach"),
  source: Schema.String,
  batchSize: Schema.optional(Schema.Number),
  steps: Steps,
});

export const HandleErrorsStepConfigSchema = Schema.Struct({
  keyword: Schema.Literal("handle_errors"),
  retries: Schema.optional(Schema.Number),
  monitor: Steps,
  rescue: Steps,
});

export const CallRecipeStepConfigSchema = Schema.Struct({
  keyword: Schema.Literal("call_recipe"),
  recipeId: Relation.ref(RECIPE_KIND, { edge: "calls" }),
  input: Schema.optional(Schema.Record(Schema.String, Schema.String)),
});

export const StopStepConfigSchema = Schema.Struct({
  keyword: Schema.Literal("stop"),
  reason: Schema.optional(Schema.String),
});

export const StepConfigSchema: Schema.Schema<StepConfig> = Schema.Union([
  ActionStepConfigSchema,
  LookupStepConfigSchema,
  IfStepConfigSchema,
  ForeachStepConfigSchema,
  HandleErrorsStepConfigSchema,
  CallRecipeStepConfigSchema,
  StopStepConfigSchema,
]) as unknown as Schema.Schema<StepConfig>;

export const RecipeConfigSchema = Schema.Struct({
  id: Relation.id(RECIPE_KIND, { display: "name" }),
  name: Schema.String,
  description: Schema.optional(Schema.String),
  folderId: Schema.optional(Relation.ref(FOLDER_KIND, { edge: "livesIn" })),
  trigger: TriggerConfigSchema,
  steps: Steps,
});
export type RecipeConfig = typeof RecipeConfigSchema.Type;

export const WorkatoWorkspaceSchema = Schema.Struct({
  folders: Schema.Array(FolderConfigSchema),
  connections: Schema.Array(ConnectionConfigSchema),
  lookupTables: Schema.Array(LookupTableConfigSchema),
  properties: Schema.NullOr(PropertiesConfigSchema),
  recipes: Schema.Array(RecipeConfigSchema),
});
export type WorkatoWorkspaceValue = typeof WorkatoWorkspaceSchema.Type;
