export type SubscriptionHandleLike = {
  readonly isEnded: () => boolean
  readonly unsubscribe: () => void
}

export type SubscriptionBuilderLike = {
  readonly onApplied: (
    callback: (ctx: unknown) => void,
  ) => SubscriptionBuilderLike
  readonly onError: (
    callback: (ctx: unknown, error?: Error) => void,
  ) => SubscriptionBuilderLike
  readonly subscribe: (query: unknown) => SubscriptionHandleLike
}

export type LiveDbConnection = {
  readonly db: Record<string, unknown>
  readonly subscriptionBuilder: () => SubscriptionBuilderLike
  readonly callReducerWithParams: (
    reducerName: string,
    paramsType: unknown,
    params: object,
  ) => Promise<void>
  readonly callProcedureWithParams: (
    procedureName: string,
    paramsType: unknown,
    params: object,
    returnType: unknown,
  ) => Promise<unknown>
  readonly disconnect: () => void
}

export type LiveDbConnectionBuilder = {
  readonly withUri: (uri: string) => LiveDbConnectionBuilder
  readonly withDatabaseName: (name: string) => LiveDbConnectionBuilder
  readonly withToken: (token: string) => LiveDbConnectionBuilder
  readonly withCompression: (
    compression: "gzip" | "brotli" | "none",
  ) => LiveDbConnectionBuilder
  readonly onConnect: (
    callback: (
      connection: LiveDbConnection,
      identity: unknown,
      token: string,
    ) => void,
  ) => LiveDbConnectionBuilder
  readonly onDisconnect: (
    callback: (ctx: unknown, error?: Error) => void,
  ) => LiveDbConnectionBuilder
  readonly onConnectError: (
    callback: (ctx: unknown, error: Error) => void,
  ) => LiveDbConnectionBuilder
  readonly build: () => LiveDbConnection
}

export type GeneratedClientModule = {
  readonly DbConnection: {
    readonly builder: () => LiveDbConnectionBuilder
  }
  readonly procedures?: Record<string, unknown>
}
