import type {
  DeployAuthField,
  DeployConnectionOptions,
  DeployEnvironment,
} from "@schematics/protocol";

export interface DefineTokenConnectionOptions {
  readonly consumer: string;
  readonly environments: readonly DeployEnvironment[];
  readonly defaultEnvironment?: string | undefined;
  readonly authId?: string | undefined;
  readonly authLabel?: string | undefined;
  readonly authDescription?: string | undefined;
  readonly tokenLabel?: string | undefined;
  readonly tokenDescription?: string | undefined;
  readonly tokenPlaceholder?: string | undefined;
}

/** Common connection shape for provider examples and token-backed SaaS APIs. */
export function defineTokenConnection(
  options: DefineTokenConnectionOptions,
): DeployConnectionOptions {
  const authId = options.authId ?? "token";
  const tokenField: DeployAuthField = {
    key: "token",
    label: options.tokenLabel ?? "Token",
    type: "password",
    required: true,
    ...(options.tokenDescription ? { description: options.tokenDescription } : {}),
    ...(options.tokenPlaceholder ? { placeholder: options.tokenPlaceholder } : {}),
  };

  return {
    consumer: options.consumer,
    defaultAuthMethod: authId,
    ...(options.defaultEnvironment ? { defaultEnvironment: options.defaultEnvironment } : {}),
    environments: [...options.environments],
    authMethods: [
      {
        id: authId,
        label: options.authLabel ?? "Token",
        description: options.authDescription ?? "An API token stored as a secret-ref.",
        fields: [tokenField],
      },
    ],
  };
}
