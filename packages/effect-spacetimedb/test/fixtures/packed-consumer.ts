import * as Effect from "effect/Effect"
import type * as Schema from "effect/Schema"
import * as Stdb from "effect-spacetimedb"
import * as Client from "effect-spacetimedb/client"
import * as Atom from "effect-spacetimedb/client/atom"
import * as Codegen from "effect-spacetimedb/codegen"
import * as DevServer from "effect-spacetimedb/dev-server"
import type * as Server from "effect-spacetimedb/server"
import * as Compiler from "effect-spacetimedb/server-compiler"
import * as Testing from "effect-spacetimedb/testing"

const columns = { id: Stdb.string().primaryKey() }
const item = Stdb.table("item", { public: true, columns })
export const group = Stdb.Group.make("Items").add(
  Stdb.Fn.reducer("itemAdd", { params: Stdb.struct({ id: Stdb.string() }) }),
)
export const app = Stdb.Module.make("app").addTables(item).add(group)
type Spec = typeof app.spec
const live = Stdb.Builder.group(app, "Items", { itemAdd: () => Effect.void })
export const compiled = Compiler.build(app, [live])

const httpOptions: Client.HttpClientOptions<Spec> = {
  module: app.spec,
  databaseName: "app",
  uri: "http://localhost",
}
declare const wsOptions: Client.WsClientOptions<Spec, unknown>
declare const config: Client.WsBuilderConfig<Spec, unknown>
export const http = Client.httpMake(httpOptions)
export const ws = Client.wsMake(wsOptions)
export const httpGroup = http.groups.Items
export const wsGroup = ws.groups.Items
export const addItem = (db: Server.DbService<Spec>) =>
  db.item.insert({ id: "one" })
export const scoped = Client.wsScoped({ module: app.spec, config })
export const layer = Client.wsLayer({ module: app.spec, config })
export const supervisor = Client.wsSupervisor({ module: app.spec, config })

export const sessionAtom = Atom.wsSupervisedSessionAtom(supervisor)
export const tableAtoms = Atom.wsTableAtomFamily<Spec>(ws)
export const rowAtoms = Atom.wsRowAtomFamily<Spec>(ws)
export const groupAtoms = Atom.wsTableGroupAtomFamily<Spec>(ws)
export const snapshotAtom = Atom.wsTableGroupSnapshotAtom(sessionAtom, ["item"])

const buffer: Client.SessionStreamBufferOptions = { bufferSize: 8 }
const streamOptions: Client.WsStreamOptions = { buffer }
const waitOptions: Client.WaitUntilOptions = { timeout: "1 second" }
export const tableRef = ws.subscribeTableRef("item", streamOptions)
export const changes = ws.streamTable("item", streamOptions)
export const ready = ws.waitUntil(
  "item",
  (row) => row.id === "first",
  waitOptions,
)

export const harnessOf = <M extends Stdb.AnyModuleSpec>(
  module: M,
): Testing.TestModuleHarness<M> =>
  Testing.makeTestModuleHarness(module, { seed: 1n })
export const harness = Testing.makeTestModuleHarness(app.spec, { seed: 1n })
export const callables = Testing.bindCallables(app, [live])
export const pumpOf = (links: ReadonlyArray<Testing.IdcPumpLink>) =>
  Testing.makeIdcPump({ links })
export const drained = (pump: Testing.IdcPump.IdcPump) => pump.drain()
export const settled = Testing.IdcDelivery.$is("Settled")
export const deliveriesMax = Testing.IdcPump.deliveriesMaxDefault

const devOptions: DevServer.DevServerOptions = {
  bundlePath: "app.js",
  dbNamePrefix: "app",
}
export const host = DevServer.makeDevServer(devOptions)
// An application can also expose the acquired handle within its scope.
declare function acquire<A, E, R>(resource: Effect.Effect<A, E, R>): A
export const devServerHandle = acquire(host)
const codegenTarget: Codegen.CodegenTarget = {
  moduleBundlePath: "app.js",
  stagingDir: "staging",
  spacetimeCommand: ["spacetime"],
  artifactDir: "bindings",
}
export const generate = Codegen.generateArtifact(codegenTarget)

// Consumer configuration can also be declared independently of a factory call.
export declare const eventBuffer: Client.EventTableStreamBufferOptions
export declare const eventStream: Client.WsEventTableStreamOptions
export declare const httpCall: Client.HttpHandlerCallOptions
export declare const automaticReconnect: Client.WsAutomaticReconnect
export declare const nativeReconnect: Client.NativeAutomaticReconnectOptions
export declare const supervisorPolicy: Client.WsSessionSupervisorPolicy<unknown>
export declare const viewRows: Client.ViewRowsOptionsParam<Spec, never>
export declare const viewGroup: Client.ViewGroupOptionsParam<Spec, []>
export declare const waitView: Client.WaitUntilViewOptionsParam<Spec, never>
export declare const mount: Stdb.MountOptions
export declare const moduleSettings: Stdb.ModuleSettings
export declare const wsLayer: Stdb.WsLayerOptions
export declare const groupOptions: Stdb.GroupOptions<
  typeof app,
  "Items",
  undefined
>
export declare const rawHttp: Stdb.RawHttpOptions
export declare const typedHttp: Stdb.TypedHttpOptions<
  typeof Schema.String,
  typeof Schema.String,
  undefined
>
export declare const field: Stdb.FieldOptions
export declare const fieldOf: Stdb.FieldOptionsOf<typeof item.columns.id>
export declare const fieldOrigin: Stdb.FieldOptionsAnnotationOrigin
export declare const normalizedOptions: Stdb.NormalizedFieldOptions
export declare const mergedFieldOptions: Stdb.MergeTableFieldOptions<{}, {}>
export declare const optionsOfColumn: Stdb.TableFieldOptionsOfValue<
  typeof columns.id
>
export declare const normalizedField: Stdb.AnyNormalizedFieldOptions
export declare const structField: Stdb.StructFieldOptions
export declare const normalizedStructField: Stdb.NormalizedStructFieldOptions
export declare const storage: Stdb.TableStorageOptions
export declare const tableArray: Stdb.TableArrayOptions<
  typeof columns,
  true,
  false,
  [],
  []
>
export declare const tableCallback: Stdb.TableCallbackOptions<
  typeof item.columns
>
export declare const outboxCallback: Stdb.OutboxTableCallbackOptions<
  typeof item.columns
>
export declare const scheduledArray: Stdb.ScheduledTableArrayOptions<
  typeof columns,
  true,
  [],
  [],
  Stdb.U64ValueType
>
export declare const scheduledCallback: Stdb.ScheduledTableCallbackOptions<
  typeof item.columns,
  Stdb.U64ValueType
>
export declare const scheduledCallable: Stdb.ScheduledCallableOptions<
  Stdb.AnyScheduledTableSpec,
  undefined
>
export declare const request: Server.ProcedureHttpRequestOptions
export declare const nativeRequest: Server.NativeProcedureHttpRequestOptions
export declare const buildOptions: Compiler.BuildOptions<never>
export declare const withRuntime: Compiler.BuildOptionsWithRuntime<
  [typeof live]
>
export declare const withoutRuntime: Compiler.BuildOptionsWithoutRuntime<
  [typeof live]
>
export declare const bind: Testing.BindCallablesOptions
export declare const publish: DevServer.PublishDatabaseOptions
export declare const lifecycle: DevServer.ModuleLifecycleOptions

export declare const httpConfig: Client.HttpClientConfig
export declare const generatedBuilder: Client.GeneratedWsBuilderConfig<
  Spec,
  unknown
>
export declare const generatedConfig: Client.WsGeneratedConfig<
  Spec,
  Client.GeneratedConnectionClassLike
>
export declare const generatedClientConfig: Client.GeneratedWsClientConfig<
  Spec,
  Client.GeneratedConnectionClassLike
>
export declare const backoff: Client.WsSessionBackoffPolicy
export declare const token: Client.WsToken
export declare const compression: Client.WsCompression
export declare const cachePolicy: Stdb.TableCachePolicy
export declare const casePolicy: Stdb.CaseConversionPolicy
export declare const hooks: Stdb.LifecycleConfig
export declare const receiverTarget: Codegen.ReceiverCodegenTarget

export const hostFailure = (error: unknown) =>
  error instanceof Stdb.StdbHostCallError &&
  error.cause instanceof Stdb.SpacetimeHostError
export const identityFailure = (error: unknown) =>
  error instanceof Stdb.IdentityFormatError
