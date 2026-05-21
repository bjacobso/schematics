import { Schema } from "effect";
import { StatusSchema } from "./common";

export const OnboardedAccountConfigSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  mode: Schema.Literals(["test", "live", "sandbox"]),
  timezone: Schema.String,
  language: Schema.String,
  source: Schema.optional(
    Schema.Struct({
      system: Schema.String,
      customer: Schema.String,
    }),
  ),
  deploy: Schema.optional(
    Schema.Struct({
      defaultTarget: Schema.Literals(["test", "live"]),
      forms: Schema.optional(Schema.Struct({ publish: Schema.Boolean })),
      policies: Schema.optional(Schema.Struct({ status: StatusSchema })),
    }),
  ),
});

export type OnboardedAccountConfig = typeof OnboardedAccountConfigSchema.Type;
