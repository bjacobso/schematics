import type { Schema } from "effect";
import type { ArtifactMatchInput, ArtifactMatcher } from "./matcher";
import type { ArtifactViewAnnotations } from "./policy";

export interface ArtifactViewConfig<Input, Output, Error> {
  readonly input?: Schema.Schema<Input> | undefined;
  readonly output: Schema.Schema<Output>;
  readonly error?: Schema.Schema<Error> | undefined;
  readonly annotations?: ArtifactViewAnnotations | undefined;
}

export interface ArtifactViewDefinition<
  TypeName extends string = string,
  ViewName extends string = string,
  Input = unknown,
  Output = unknown,
  Error = unknown,
> {
  readonly _tag: "ArtifactView";
  readonly id: `${TypeName}.${ViewName}`;
  readonly type: TypeName;
  readonly name: ViewName;
  readonly input?: Schema.Schema<Input> | undefined;
  readonly output: Schema.Schema<Output>;
  readonly error?: Schema.Schema<Error> | undefined;
  readonly annotations: ArtifactViewAnnotations;
}

export type AnyArtifactView = ArtifactViewDefinition<string, string, unknown, unknown, unknown>;
export type ArtifactViewInput<View> =
  View extends ArtifactViewDefinition<string, string, infer Input, unknown, unknown>
    ? Input
    : never;
export type ArtifactViewOutput<View> =
  View extends ArtifactViewDefinition<string, string, unknown, infer Output, unknown>
    ? Output
    : never;
export type ArtifactViewError<View> =
  View extends ArtifactViewDefinition<string, string, unknown, unknown, infer Error>
    ? Error
    : never;

export type ArtifactViewMap = Readonly<Record<string, AnyArtifactView>>;

export class ArtifactTypeDeclaration<
  TypeName extends string,
  Views extends ArtifactViewMap = Record<never, never>,
> {
  readonly _tag = "ArtifactType";

  static create<TypeName extends string>(name: TypeName): ArtifactTypeDeclaration<TypeName> {
    return new ArtifactTypeDeclaration(name);
  }

  constructor(
    readonly name: TypeName,
    readonly matchers: readonly ArtifactMatcher[] = [],
    readonly views: Views = {} as Views,
  ) {}

  match(matcher: ArtifactMatcher): ArtifactTypeDeclaration<TypeName, Views> {
    return new ArtifactTypeDeclaration(this.name, [...this.matchers, matcher], this.views);
  }

  view<ViewName extends Extract<keyof Views, string>>(name: ViewName): Views[ViewName];
  view<ViewName extends string, Input = undefined, Output = unknown, Error = unknown>(
    name: ViewName,
    config: ArtifactViewConfig<Input, Output, Error>,
  ): ArtifactTypeDeclaration<
    TypeName,
    Views & Record<ViewName, ArtifactViewDefinition<TypeName, ViewName, Input, Output, Error>>
  >;
  view(name: string, config?: ArtifactViewConfig<unknown, unknown, unknown>): unknown {
    if (!config) {
      const view = this.views[name];
      if (!view) throw new Error(`Unknown artifact view: ${this.name}.${name}`);
      return view;
    }

    const view = makeView(this.name, name, config);
    return new ArtifactTypeDeclaration(this.name, this.matchers, {
      ...this.views,
      [name]: view,
    });
  }

  listViews(): readonly Views[Extract<keyof Views, string>][] {
    return Object.values(this.views) as unknown as readonly Views[Extract<keyof Views, string>][];
  }

  matches(input: ArtifactMatchInput): boolean {
    return this.matchers.length === 0 || this.matchers.some((matcher) => matcher.matches(input));
  }
}

export type AnyArtifactType = ArtifactTypeDeclaration<string, ArtifactViewMap>;

export const ArtifactType = {
  make: <TypeName extends string>(name: TypeName): ArtifactTypeDeclaration<TypeName> =>
    ArtifactTypeDeclaration.create(name),
} as const;

function makeView<TypeName extends string, ViewName extends string, Input, Output, Error>(
  type: TypeName,
  name: ViewName,
  config: ArtifactViewConfig<Input, Output, Error>,
): ArtifactViewDefinition<TypeName, ViewName, Input, Output, Error> {
  return {
    _tag: "ArtifactView",
    id: `${type}.${name}`,
    type,
    name,
    output: config.output,
    annotations: config.annotations ?? {},
    ...(config.input ? { input: config.input } : {}),
    ...(config.error ? { error: config.error } : {}),
  };
}
