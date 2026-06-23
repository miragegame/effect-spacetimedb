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
  readonly token?: string
  readonly compression?: WsCompression
  readonly lightMode?: boolean
  readonly confirmedReads?: boolean
  readonly createWebSocket?: unknown
  readonly configureBuilder?: (
    builder: GeneratedWsBuilderLike<Module, ErrorContext, RelationContext>,
  ) => GeneratedWsBuilderLike<Module, ErrorContext, RelationContext>
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

// The shape a native spacetime-generated `DbConnection` class exposes statically. The
// native builder's types are derived from the generated REMOTE_MODULE and are unrelated
// to our ModuleSpec-derived types, so the config accepts the class structurally and
// `generatedConfig` performs the single sanctioned narrowing below.
export type GeneratedConnectionClassLike = {
  readonly builder: () => unknown
}

export type GeneratedWsClientConfig<
  Module extends AnyModuleSpec,
  ErrorContext,
  RelationContext = unknown,
> = Omit<
  GeneratedWsBuilderConfig<Module, ErrorContext, RelationContext>,
  "builder"
> & {
  readonly DbConnection: GeneratedConnectionClassLike
}

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
  Module extends AnyModuleSpec,
  ErrorContext,
  RelationContext,
>(
  config: GeneratedWsClientConfig<Module, ErrorContext, RelationContext>,
): GeneratedWsBuilderConfig<Module, ErrorContext, RelationContext> => {
  const { DbConnection, ...builderConfig } = config
  return {
    ...builderConfig,
    // The one sanctioned narrowing for the native-generated ↔ spec-typed seam: the
    // native DbConnectionBuilder structurally implements GeneratedWsBuilderLike at
    // runtime (configureGeneratedWsBuilder exercises withUri/withDatabaseName/build
    // immediately, so a wrong shape fails fast). Consumers pass the generated class
    // directly and must not cast.
    builder: () =>
      DbConnection.builder() as GeneratedWsBuilderLike<
        Module,
        ErrorContext,
        RelationContext
      >,
  }
}

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
