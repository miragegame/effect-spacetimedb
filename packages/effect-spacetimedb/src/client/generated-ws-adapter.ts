import * as Data from "effect/Data"
import type { Identity } from "spacetimedb"
import type { AnyModuleSpec } from "../contract/module.ts"
import { errorTypeId, hasErrorTypeId } from "../error-identity.ts"
import type { WsCallableTransport, WsConnectionLike } from "./ws-client.ts"

export type WsCompression = "gzip" | "brotli" | "none"

export type ManagedWsConnection<
  Module extends AnyModuleSpec,
  ErrorContext,
  RelationContext = unknown,
> = WsConnectionLike<Module, ErrorContext, RelationContext> &
  Partial<WsCallableTransport> & {
    readonly disconnect: () => void
    readonly isActive?: boolean | undefined
  }

export interface GeneratedWsBuilderLike<
  Module extends AnyModuleSpec,
  ErrorContext,
  RelationContext = unknown,
> {
  withUri(
    uri: string,
  ): GeneratedWsBuilderLike<Module, ErrorContext, RelationContext>
  withDatabaseName(
    name: string,
  ): GeneratedWsBuilderLike<Module, ErrorContext, RelationContext>
  withToken(
    token: string,
  ): GeneratedWsBuilderLike<Module, ErrorContext, RelationContext>
  withCompression(
    compression: WsCompression,
  ): GeneratedWsBuilderLike<Module, ErrorContext, RelationContext>
  withLightMode?(
    lightMode: boolean,
  ): GeneratedWsBuilderLike<Module, ErrorContext, RelationContext>
  withConfirmedReads?(
    confirmedReads: boolean,
  ): GeneratedWsBuilderLike<Module, ErrorContext, RelationContext>
  withWSFn?(
    createWebSocket: unknown,
  ): GeneratedWsBuilderLike<Module, ErrorContext, RelationContext>
  onConnect(
    callback: (
      connection: ManagedWsConnection<Module, ErrorContext, RelationContext>,
      identity: Identity,
      token: string,
    ) => void,
  ): GeneratedWsBuilderLike<Module, ErrorContext, RelationContext>
  onDisconnect(
    callback: (context: ErrorContext, error?: Error) => void,
  ): GeneratedWsBuilderLike<Module, ErrorContext, RelationContext>
  onConnectError(
    callback: (context: ErrorContext, error: Error) => void,
  ): GeneratedWsBuilderLike<Module, ErrorContext, RelationContext>
  build(): ManagedWsConnection<Module, ErrorContext, RelationContext>
}

export type GeneratedWsBuilderConfig<
  Module extends AnyModuleSpec,
  ErrorContext,
  RelationContext = unknown,
> = {
  readonly builder: () => GeneratedWsBuilderLike<
    Module,
    ErrorContext,
    RelationContext
  >
  readonly uri: string
  readonly databaseName: string
  readonly token?: string | undefined
  readonly compression?: WsCompression | undefined
  readonly lightMode?: boolean | undefined
  readonly confirmedReads?: boolean | undefined
  readonly connectTimeoutMillis?: number | undefined
  readonly createWebSocket?: unknown | undefined
  readonly configureBuilder?:
    | ((
        builder: GeneratedWsBuilderLike<Module, ErrorContext, RelationContext>,
      ) => GeneratedWsBuilderLike<Module, ErrorContext, RelationContext>)
    | undefined
}

export type GeneratedWsConnectionFactory<
  Module extends AnyModuleSpec,
  ErrorContext,
  RelationContext = unknown,
> = {
  readonly builder: () => GeneratedWsBuilderLike<
    Module,
    ErrorContext,
    RelationContext
  >
}

export type GeneratedWsErrorContext = {
  readonly db: unknown
  readonly reducers: unknown
  readonly isActive: boolean
  readonly subscriptionBuilder: unknown
  readonly disconnect: () => void
  readonly event?: Error
}

export type GeneratedConnectionOf<Module extends AnyModuleSpec> =
  GeneratedWsConnectionFactory<Module, GeneratedWsErrorContext>

// The shape a native spacetime-generated `DbConnection` class exposes statically. The
// native builder's types are derived from the generated REMOTE_MODULE and are unrelated
// to our ModuleSpec-derived types, so the config accepts the class structurally and
// `generatedConfig` performs the single sanctioned narrowing below.
export type GeneratedConnectionClassLike = {
  readonly builder: () => unknown
}

export const generatedConnection = <Module extends AnyModuleSpec>(
  _module: Module,
  connectionClass: GeneratedConnectionClassLike,
): GeneratedConnectionOf<Module> =>
  connectionClass as GeneratedConnectionOf<Module>

type IsAny<Value> = 0 extends 1 & Value ? true : false

type DiagnosticRecord<Keys extends string> = [Keys] extends [never]
  ? unknown
  : {
      readonly [Key in Keys]: never
    }

type ErrorContextFromBuilder<Builder> = IsAny<Builder> extends true
  ? never
  : Builder extends {
        readonly onConnectError: (
          callback: (context: infer ErrorContext, error: Error) => void,
        ) => unknown
      }
    ? IsAny<ErrorContext> extends true
      ? never
      : ErrorContext
    : Builder extends GeneratedWsBuilderLike<
          AnyModuleSpec,
          infer ErrorContext,
          infer _RelationContext
        >
      ? IsAny<ErrorContext> extends true
        ? never
        : ErrorContext
      : never

type ErrorContextFromConnectionInstance<Connection> = Connection extends {
  readonly db: infer Db
  readonly reducers: infer Reducers
  readonly isActive: infer IsActive
  readonly subscriptionBuilder: infer SubscriptionBuilder
  readonly disconnect: infer Disconnect
}
  ? {
      readonly db: Db
      readonly reducers: Reducers
      readonly isActive: IsActive
      readonly subscriptionBuilder: SubscriptionBuilder
      readonly disconnect: Disconnect
      readonly event?: Error
    }
  : never

type ErrorContextFromConnectionPrototype<ConnectionClass> =
  ConnectionClass extends {
    readonly prototype: infer Connection
  }
    ? ErrorContextFromConnectionInstance<Connection>
    : never

export type GeneratedErrorContextOf<ConnectionClass> =
  IsAny<ConnectionClass> extends true
    ? never
    : [ErrorContextFromConnectionPrototype<ConnectionClass>] extends [never]
      ? ConnectionClass extends { readonly builder: () => infer Builder }
        ? ErrorContextFromBuilder<Builder>
        : never
      : ErrorContextFromConnectionPrototype<ConnectionClass>

export type ModuleOfGeneratedConnection<ConnectionClass> =
  ConnectionClass extends GeneratedWsConnectionFactory<
    infer Module,
    infer _ErrorContext,
    infer _RelationContext
  >
    ? Module
    : AnyModuleSpec

type InvalidGeneratedConnectionDiagnostic<ConnectionClass> = [
  GeneratedErrorContextOf<ConnectionClass>,
] extends [never]
  ? DiagnosticRecord<"Generated DbConnection must expose a typed builder; pass the generated DbConnection class, not an erased or untyped value">
  : unknown

export type MismatchedGeneratedModuleDiagnostic<
  Module extends AnyModuleSpec,
  ConnectionClass,
> = AnyModuleSpec extends ModuleOfGeneratedConnection<ConnectionClass>
  ? unknown
  : [ModuleOfGeneratedConnection<ConnectionClass>] extends [Module]
    ? [Module] extends [ModuleOfGeneratedConnection<ConnectionClass>]
      ? unknown
      : DiagnosticRecord<"Generated DbConnection belongs to a different module; pass the facade created for this project module">
    : DiagnosticRecord<"Generated DbConnection belongs to a different module; pass the facade created for this project module">

const optionalProperty = <const Key extends string, Value>(
  key: Key,
  value: Value | undefined,
): Partial<Record<Key, Value>> =>
  value === undefined ? {} : ({ [key]: value } as Record<Key, Value>)

export type GeneratedWsClientConfig<
  Module extends AnyModuleSpec,
  ConnectionClass extends GeneratedConnectionClassLike,
  RelationContext = unknown,
> = Omit<
  GeneratedWsBuilderConfig<
    Module,
    GeneratedErrorContextOf<ConnectionClass>,
    RelationContext
  >,
  "builder"
> & {
  readonly DbConnection: ConnectionClass
} & InvalidGeneratedConnectionDiagnostic<ConnectionClass>

const WsUnsupportedBuilderFeatureErrorTypeId = errorTypeId(
  "WsUnsupportedBuilderFeatureError",
)
export class WsUnsupportedBuilderFeatureError extends Data.TaggedError(
  "WsUnsupportedBuilderFeatureError",
)<{
  readonly feature: "withLightMode" | "withConfirmedReads" | "withWSFn"
}> {
  readonly [WsUnsupportedBuilderFeatureErrorTypeId] =
    WsUnsupportedBuilderFeatureErrorTypeId
  static is = hasErrorTypeId<WsUnsupportedBuilderFeatureError>(
    WsUnsupportedBuilderFeatureErrorTypeId,
  )
}

export const generatedConfig = <
  const ConnectionClass extends GeneratedConnectionClassLike,
  Module extends AnyModuleSpec = ModuleOfGeneratedConnection<ConnectionClass>,
  RelationContext = unknown,
>(
  config: GeneratedWsClientConfig<Module, ConnectionClass, RelationContext>,
): GeneratedWsBuilderConfig<
  Module,
  GeneratedErrorContextOf<ConnectionClass>,
  RelationContext
> => ({
  uri: config.uri,
  databaseName: config.databaseName,
  ...optionalProperty("token", config.token),
  ...optionalProperty("compression", config.compression),
  ...optionalProperty("lightMode", config.lightMode),
  ...optionalProperty("confirmedReads", config.confirmedReads),
  ...optionalProperty("connectTimeoutMillis", config.connectTimeoutMillis),
  ...optionalProperty("createWebSocket", config.createWebSocket),
  ...optionalProperty("configureBuilder", config.configureBuilder),
  // The one sanctioned narrowing for the native-generated ↔ spec-typed seam: the
  // native DbConnectionBuilder structurally implements GeneratedWsBuilderLike at
  // runtime (configureGeneratedWsBuilder exercises withUri/withDatabaseName/build
  // immediately, so a wrong shape fails fast). Consumers pass the generated class
  // directly and must not cast.
  builder: () =>
    config.DbConnection.builder() as GeneratedWsBuilderLike<
      Module,
      GeneratedErrorContextOf<ConnectionClass>,
      RelationContext
    >,
})

export const configureGeneratedWsBuilder = <
  Module extends AnyModuleSpec,
  ErrorContext,
  RelationContext,
>(
  config: GeneratedWsBuilderConfig<Module, ErrorContext, RelationContext>,
): GeneratedWsBuilderLike<Module, ErrorContext, RelationContext> => {
  let builder = config.builder()
  builder = builder.withUri(config.uri).withDatabaseName(config.databaseName)

  if (config.token !== undefined) {
    builder = builder.withToken(config.token)
  }

  if (config.compression !== undefined) {
    builder = builder.withCompression(config.compression)
  }

  if (config.lightMode !== undefined) {
    if (builder.withLightMode == null) {
      throw new WsUnsupportedBuilderFeatureError({
        feature: "withLightMode",
      })
    }
    builder = builder.withLightMode(config.lightMode)
  }

  if (config.confirmedReads !== undefined) {
    if (builder.withConfirmedReads == null) {
      throw new WsUnsupportedBuilderFeatureError({
        feature: "withConfirmedReads",
      })
    }
    builder = builder.withConfirmedReads(config.confirmedReads)
  }

  if (config.createWebSocket !== undefined) {
    if (builder.withWSFn == null) {
      throw new WsUnsupportedBuilderFeatureError({
        feature: "withWSFn",
      })
    }
    builder = builder.withWSFn(config.createWebSocket)
  }

  return config.configureBuilder != null
    ? config.configureBuilder(builder)
    : builder
}
