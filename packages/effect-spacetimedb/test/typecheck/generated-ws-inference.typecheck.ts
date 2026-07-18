import * as Stdb from "effect-spacetimedb"
import * as StdbClient from "effect-spacetimedb/client"
import type * as Layer from "effect/Layer"
import {
  DbConnectionBuilder as NativeDbConnectionBuilder,
  DbConnectionImpl,
  type ErrorContextInterface,
  type RemoteModule,
} from "spacetimedb"
import { FullModule } from "../fixtures/full-module"
import { MinimalModule } from "../fixtures/minimal-module"
import { DbConnection as RawArtifactDbConnection } from "../../examples/publishable-module/generated-client/index.js"
import type { Assert, ErrorOf, IsAny, IsAssignable, IsEqual } from "./helpers"

type GeneratedSchema = {
  readonly tables: Record<string, never>
}
type GeneratedReducers = {
  readonly reducers: readonly []
}
type GeneratedProcedures = {
  readonly procedures: readonly []
}

declare const REMOTE_MODULE: RemoteModule<
  GeneratedSchema,
  GeneratedReducers,
  GeneratedProcedures,
  "2.6.1"
>
type ErrorContext = ErrorContextInterface<typeof REMOTE_MODULE>

declare class DbConnection extends DbConnectionImpl<typeof REMOTE_MODULE> {
  static builder(): DbConnectionBuilder
}

declare class DbConnectionBuilder extends NativeDbConnectionBuilder<DbConnection> {}

type InferredErrorContext = StdbClient.GeneratedErrorContextOf<
  typeof DbConnection
>
type _generatedErrorContextIsNotAny = Assert<
  IsEqual<IsAny<InferredErrorContext>, false>
>
type _generatedErrorContextIsInferred = Assert<
  IsAssignable<InferredErrorContext, ErrorContext>
>

type LayerErrorOf<Value> = Value extends Layer.Layer<
  infer _ROut,
  infer Error,
  infer _RIn
>
  ? Error
  : never

const Full = Stdb.project(FullModule)
void Full.client.ws.layerGenerated({
  DbConnection,
  uri: "ws://localhost:3000",
  databaseName: "generated-inference",
})

declare const ErasedDbConnection: {
  readonly builder: () => unknown
}
// @ts-expect-error erased generated classes must be rejected loudly.
void Full.client.ws.layerGenerated({
  DbConnection: ErasedDbConnection,
  uri: "ws://localhost:3000",
  databaseName: "generated-erased",
})

const FullFacade = StdbClient.generatedConnection(
  FullModule,
  ErasedDbConnection,
)

// @ts-expect-error the real committed artifact is erased and must go through generatedConnection.
void Full.client.ws.layerGenerated({
  DbConnection: RawArtifactDbConnection,
  uri: "ws://localhost:3000",
  databaseName: "raw-artifact",
})
type _facadeCarriesModule = Assert<
  IsEqual<
    typeof FullFacade,
    StdbClient.GeneratedConnectionOf<typeof FullModule>
  >
>
type _facadeUsesStableErrorContext = Assert<
  IsEqual<
    StdbClient.GeneratedErrorContextOf<typeof FullFacade>,
    StdbClient.GeneratedWsErrorContext
  >
>

const generatedScoped = Full.client.ws.scopedGenerated({
  DbConnection: FullFacade,
  uri: "ws://localhost:3000",
  databaseName: "generated-facade",
})
type _generatedScopedFailureIsTyped = Assert<
  IsEqual<
    ErrorOf<typeof generatedScoped>,
    StdbClient.WsConnectError | StdbClient.GeneratedArtifactShapeError
  >
>

declare const FullBuilder: StdbClient.GeneratedWsBuilderLike<
  typeof FullModule,
  unknown
>
const rawScoped = StdbClient.wsScoped({
  module: FullModule,
  config: {
    builder: () => FullBuilder,
    uri: "ws://localhost:3000",
    databaseName: "raw-scoped",
  },
})
type _rawScopedFailureUnchanged = Assert<
  IsEqual<ErrorOf<typeof rawScoped>, StdbClient.WsConnectError>
>

const rawLayer = StdbClient.wsLayer({
  module: FullModule,
  config: {
    builder: () => FullBuilder,
    uri: "ws://localhost:3000",
    databaseName: "raw-layer",
  },
})
type _rawLayerFailureUnchanged = Assert<
  IsEqual<LayerErrorOf<typeof rawLayer>, StdbClient.WsConnectError>
>

const Minimal = Stdb.project(MinimalModule)
// @ts-expect-error a generated facade is tied to its originating module.
void Minimal.client.ws.scopedGenerated({
  DbConnection: FullFacade,
  uri: "ws://localhost:3000",
  databaseName: "wrong-module",
})

// @ts-expect-error a generated facade is tied to its originating module.
void Minimal.client.ws.layerGenerated({
  DbConnection: FullFacade,
  uri: "ws://localhost:3000",
  databaseName: "wrong-module-layer",
})

void Minimal.client.ws.layerGenerated({
  DbConnection,
  uri: "ws://localhost:3000",
  databaseName: "native-minimal",
})

void StdbClient.wsScopedGenerated({
  module: MinimalModule,
  // @ts-expect-error a generated facade is tied to its originating module.
  config: {
    DbConnection: FullFacade,
    uri: "ws://localhost:3000",
    databaseName: "wrong-module-direct-scoped",
  },
})

void StdbClient.wsLayerGenerated({
  module: MinimalModule,
  // @ts-expect-error a generated facade is tied to its originating module.
  config: {
    DbConnection: FullFacade,
    uri: "ws://localhost:3000",
    databaseName: "wrong-module-direct-layer",
  },
})

const configForFreeModule = <Module extends Stdb.AnyModuleSpec>(
  module: Module,
): StdbClient.WsGeneratedConfig<Module, typeof FullFacade> => {
  void module
  return {
    DbConnection: FullFacade,
    uri: "ws://localhost:3000",
    databaseName: "free-module-config",
  }
}
void configForFreeModule

declare const AnyDbConnection: any
// @ts-expect-error any-typed generated classes must be rejected loudly.
void Full.client.ws.layerGenerated({
  DbConnection: AnyDbConnection,
  uri: "ws://localhost:3000",
  databaseName: "generated-any",
})
