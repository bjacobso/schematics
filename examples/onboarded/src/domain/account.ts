import { Schema } from "effect";

/** Mirror of the domain Account resource (internal `/accounts`, list-only). Id prefix `acc_`. */
export const DashboardBrandingDtoSchema = Schema.Struct({
  brand_name: Schema.NullOr(Schema.String),
  brand_icon: Schema.NullOr(Schema.String),
});

export const AccountDtoSchema = Schema.Struct({
  id: Schema.String, // acc_
  is_test: Schema.Boolean,
  organization: Schema.Struct({
    uid: Schema.String,
    name: Schema.String,
    connect_type: Schema.String,
    dashboard_brand_name: Schema.NullOr(Schema.String),
    dashboard_brand_icon: Schema.NullOr(Schema.String),
  }),
  effective_branding: Schema.NullOr(DashboardBrandingDtoSchema),
});
export type AccountDto = typeof AccountDtoSchema.Type;
