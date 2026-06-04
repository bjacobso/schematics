import { Relation } from "@schematics/algebra";
import { Schema } from "effect";
import type { AccountDto } from "../domain/account";
import { ACCOUNT_KIND } from "./refs";

/** Config-file shape for the account (read-only — the API is list-only). */
export const OnboardedAccountConfigSchema = Schema.Struct({
  id: Relation.id(ACCOUNT_KIND, { display: "organization.name" }),
  isTest: Schema.Boolean,
  organization: Schema.Struct({
    name: Schema.String,
    connectType: Schema.String,
  }),
  branding: Schema.NullOr(
    Schema.Struct({
      brandName: Schema.NullOr(Schema.String),
      brandIcon: Schema.NullOr(Schema.String),
    }),
  ),
});
export type OnboardedAccountConfig = typeof OnboardedAccountConfigSchema.Type;

export const accountConfigFromDto = (dto: AccountDto): OnboardedAccountConfig => ({
  id: dto.id,
  isTest: dto.is_test,
  organization: { name: dto.organization.name, connectType: dto.organization.connect_type },
  branding: dto.effective_branding
    ? { brandName: dto.effective_branding.brand_name, brandIcon: dto.effective_branding.brand_icon }
    : null,
});
