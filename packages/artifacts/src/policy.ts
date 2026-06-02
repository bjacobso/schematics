export type ArtifactCost = "low" | "medium" | "high";

export const Cost = {
  low: "low",
  medium: "medium",
  high: "high",
} as const satisfies Record<ArtifactCost, ArtifactCost>;

export type ArtifactCachePolicy = "none" | "ref" | "contentHash" | "explicitKey" | "session";

export const CachePolicy = {
  none: "none",
  ref: "ref",
  contentHash: "contentHash",
  explicitKey: "explicitKey",
  session: "session",
} as const satisfies Record<ArtifactCachePolicy, ArtifactCachePolicy>;

export type ArtifactPrivacyPolicy = "localOnly" | "remoteAllowed" | "redactionRequired";

export const PrivacyPolicy = {
  localOnly: "localOnly",
  remoteAllowed: "remoteAllowed",
  redactionRequired: "redactionRequired",
} as const satisfies Record<ArtifactPrivacyPolicy, ArtifactPrivacyPolicy>;

export type ArtifactLatencyPolicy = "interactive" | "background";

export const LatencyPolicy = {
  interactive: "interactive",
  background: "background",
} as const satisfies Record<ArtifactLatencyPolicy, ArtifactLatencyPolicy>;

export type ArtifactDeterminismPolicy = "deterministic" | "bestEffort" | "modelGenerated";

export const DeterminismPolicy = {
  deterministic: "deterministic",
  bestEffort: "bestEffort",
  modelGenerated: "modelGenerated",
} as const satisfies Record<ArtifactDeterminismPolicy, ArtifactDeterminismPolicy>;

export type ArtifactOutputSizePolicy = "bounded" | "potentiallyLarge" | "streamable";

export const OutputSizePolicy = {
  bounded: "bounded",
  potentiallyLarge: "potentiallyLarge",
  streamable: "streamable",
} as const satisfies Record<ArtifactOutputSizePolicy, ArtifactOutputSizePolicy>;

export interface ArtifactViewAnnotations {
  readonly cost?: ArtifactCost | undefined;
  readonly cache?: ArtifactCachePolicy | undefined;
  readonly privacy?: ArtifactPrivacyPolicy | undefined;
  readonly latency?: ArtifactLatencyPolicy | undefined;
  readonly determinism?: ArtifactDeterminismPolicy | undefined;
  readonly outputSize?: ArtifactOutputSizePolicy | undefined;
  readonly mediaType?: string | undefined;
  readonly [key: string]: unknown;
}
