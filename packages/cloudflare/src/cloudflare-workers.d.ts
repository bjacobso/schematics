declare module "cloudflare:workers" {
  export class DurableObject<Env = unknown> {
    protected readonly ctx: DurableObjectState;
    protected readonly env: Env;

    constructor(ctx: DurableObjectState, env: Env);
  }

  export interface DurableObjectState {
    readonly storage: DurableObjectStorage;
  }

  export interface DurableObjectStorage {
    get<T = unknown>(key: string): Promise<T | undefined>;
    list<T = unknown>(options?: { readonly prefix?: string | undefined }): Promise<Map<string, T>>;
    put<T>(key: string, value: T): Promise<void>;
    transaction<T>(closure: (transaction: DurableObjectTransaction) => Promise<T>): Promise<T>;
  }

  export interface DurableObjectTransaction {
    get<T = unknown>(key: string): Promise<T | undefined>;
    list<T = unknown>(options?: { readonly prefix?: string | undefined }): Promise<Map<string, T>>;
    put<T>(key: string, value: T): Promise<void>;
    delete(key: string): Promise<boolean>;
    delete(keys: string[]): Promise<number>;
  }
}
