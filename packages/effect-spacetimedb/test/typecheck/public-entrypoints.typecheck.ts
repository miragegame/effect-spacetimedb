import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import type * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import type * as Atom from "effect/unstable/reactivity/Atom"
import * as Stdb from "effect-spacetimedb"
import * as StdbClient from "effect-spacetimedb/client"
import * as StdbAtom from "effect-spacetimedb/client/atom"
import * as Server from "effect-spacetimedb/server"
import * as StdbCompiler from "effect-spacetimedb/server-compiler"
import { build, type CompiledModule } from "effect-spacetimedb/server-compiler"
import * as StdbTesting from "effect-spacetimedb/testing"
import type { ErrorOf } from "./helpers"

const PublicEntrypointString = Stdb.string(
  Schema.String.pipe(Schema.check(Schema.isMaxLength(255))),
)
const PublicEntrypointU32 = Schema.Finite.check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
)
const PublicEntrypointI32 = Schema.Finite.check(Schema.isInt())
const PublicEntrypointU64 = Schema.BigInt.check(
  Schema.isGreaterThanOrEqualToBigInt(0n),
)

const PublicViews = Stdb.StdbGroup.make("Views").add(
  Stdb.StdbFn.anonymousView("allUsers", {
    returns: Stdb.array(
      Stdb.struct({
        id: PublicEntrypointString,
      }),
    ),
  }),
)

const publicEntrypointsUser = Stdb.table("user", {
  public: true,
  columns: {
    id: PublicEntrypointString.primaryKey(),
  },
})
const publicEntrypointsNoPk = Stdb.table("public_no_pk", {
  public: true,
  columns: {
    label: PublicEntrypointString,
  },
})
const publicEntrypointsMultiPk = Stdb.table("public_multi_pk", {
  public: true,
  columns: {
    id: PublicEntrypointString.primaryKey(),
    tenantId: PublicEntrypointString.primaryKey(),
  },
})

const publicEntrypointColumnKey: Stdb.ColumnKey<typeof publicEntrypointsUser> =
  "id"
const publicEntrypointPrimaryKey: Stdb.PrimaryKeyNames<
  typeof publicEntrypointsUser
> = "id"
const publicEntrypointSinglePrimaryKey: Stdb.SinglePrimaryKeyName<
  typeof publicEntrypointsUser
> = "id"
const publicEntrypointSinglePrimaryKeyValue: Stdb.SinglePrimaryKeyValue<
  typeof publicEntrypointsUser
> = "user_1"
void publicEntrypointColumnKey
void publicEntrypointPrimaryKey
void publicEntrypointSinglePrimaryKey
void publicEntrypointSinglePrimaryKeyValue

const PublicEntrypointModule = Stdb.StdbModule.make("public_entrypoints", {})
  .addTables(publicEntrypointsUser)
  .add(PublicViews)
const Module = PublicEntrypointModule.spec
const PublicEntrypointNoPkModule = Stdb.StdbModule.make(
  "public_entrypoints_no_pk",
  {},
).addTables(publicEntrypointsNoPk).spec
const PublicEntrypointMultiPkModule = Stdb.StdbModule.make(
  "public_entrypoints_multi_pk",
  {},
).addTables(publicEntrypointsMultiPk).spec
type PublicEntrypointGroupNames = Stdb.GroupNames<typeof PublicEntrypointModule>
type PublicEntrypointGroupEndpointPairs = Stdb.GroupEndpointPairsOfModule<
  typeof PublicEntrypointModule
>
type PublicViewsGroupName = Stdb.GroupNameOf<typeof PublicViews>
type PublicViewsGroupEndpointPairs = Stdb.GroupEndpointPairsOf<
  typeof PublicViews
>
const _publicEntrypointGroupName: PublicEntrypointGroupNames = "Views"
const _publicEntrypointEndpointPair: PublicEntrypointGroupEndpointPairs = {
  group: "Views",
  name: "allUsers",
}
const _publicViewsGroupName: PublicViewsGroupName = "Views"
const _publicViewsEndpointPair: PublicViewsGroupEndpointPairs = {
  group: "Views",
  name: "allUsers",
}
void _publicEntrypointGroupName
void _publicEntrypointEndpointPair
void _publicViewsGroupName
void _publicViewsEndpointPair

void Stdb.u32(PublicEntrypointU32)
void Stdb.u8(PublicEntrypointU32)
void Stdb.u16(PublicEntrypointU32)
void Stdb.i8(PublicEntrypointI32)
void Stdb.i16(PublicEntrypointI32)
void Stdb.i32(PublicEntrypointI32)
void Stdb.f32(PublicEntrypointI32)
void Stdb.bytes()
void Stdb.i64(PublicEntrypointU64)
void Stdb.i128(PublicEntrypointU64)
void Stdb.i256(PublicEntrypointU64)
void Stdb.u256(PublicEntrypointU64)

void Stdb.u32(PublicEntrypointU32).default(0)
void PublicEntrypointString.name("display_name")
// @ts-expect-error column defaults must match the authored Stdb type
void Stdb.u32(PublicEntrypointU32).default("0")

class PublicMissing extends Schema.TaggedErrorClass<PublicMissing>()(
  "PublicMissing",
  {},
) {}

class PublicConflict extends Schema.TaggedErrorClass<PublicConflict>()(
  "PublicConflict",
  {},
) {}

const PublicErrors = Stdb.errors(PublicMissing, PublicConflict)
void PublicErrors.pick("PublicMissing")
// @ts-expect-error pick only accepts declared tags from the registry
void PublicErrors.pick("NotDeclared")
declare const publicCall: Effect.Effect<void, PublicMissing | PublicConflict>
const publicMissingRecovered = publicCall.pipe(
  Effect.catchTags({
    PublicMissing: () => Effect.void,
  }),
)
type PublicMissingRecoveredError = ErrorOf<typeof publicMissingRecovered>
const _publicConflictCanStillFail: PublicMissingRecoveredError =
  PublicConflict.make({})
// @ts-expect-error handled PublicMissing should not remain in the error channel; @effect-diagnostics-next-line missingEffectError:off
const _publicMissingCannotStillFail: PublicMissingRecoveredError =
  PublicMissing.make({})
void _publicConflictCanStillFail
void _publicMissingCannotStillFail

declare const publicRawCall: Effect.Effect<
  void,
  StdbClient.DomainCallError<PublicMissing | PublicConflict>
>
void publicRawCall.pipe(
  Effect.catchTag("DomainCallError", ({ error }) => Effect.fail(error)),
)

declare const server: Server.ServerInstance<typeof Module>
const projected = Stdb.project(Module)
const httpApi = Stdb.toHttpApi(Module)
const publicEntrypointIndexAlgorithm: Stdb.IndexAlgorithm = "direct"
declare const publicWsSession: StdbClient.WsSession<typeof Module>
declare const publicAtomSession: StdbAtom.TableAtomSession<typeof Module>
declare const publicConnectionAtom: Atom.Atom<
  AsyncResult.AsyncResult<StdbAtom.TableAtomSession<typeof Module>, "connect">
>
declare const publicNoPkSession: StdbClient.WsSession<
  typeof PublicEntrypointNoPkModule
>
declare const publicMultiPkSession: StdbClient.WsSession<
  typeof PublicEntrypointMultiPkModule
>

void server
void server.dispose
void httpApi
void publicEntrypointIndexAlgorithm
void Stdb.StdbHttpProjectionError
void Stdb.httpApiBaseUrl({ uri: "http://localhost:3000/", databaseName: "db" })
void StdbClient.makeWsClient
void StdbClient.DomainCallError
void Stdb.describe(PublicEntrypointString)
void Stdb.validate(Module)
void Stdb.assertValid(Module)
void Stdb.StdbBuilder.plan
void build
void projected.targets.tables.user
void projected.targets.allPublicTables()
void publicWsSession.subscribeRowRef("user", "user_1")
void publicWsSession.rowMatchesPrimaryKey("user", { id: "user_1" }, "user_1")
void StdbAtom.rowAtomFamily(publicAtomSession)("user", "user_1")
const publicSnapshotAtom = StdbAtom.tableGroupSnapshotAtom(
  publicConnectionAtom,
  ["user"] as const,
)
const publicSnapshotConnectFailure: Atom.Failure<typeof publicSnapshotAtom> =
  "connect"
const publicSnapshotTableFailure: Atom.Failure<typeof publicSnapshotAtom> =
  new StdbClient.SubscriptionInvalidatedError({
    raw: "closed",
  })
void publicSnapshotConnectFailure
void publicSnapshotTableFailure

// @ts-expect-error snapshot atom keys must be public persistent tables
void StdbAtom.tableGroupSnapshotAtom(publicConnectionAtom, ["private_user"])

// @ts-expect-error row refs require the table primary-key value type
void publicWsSession.subscribeRowRef("user", 1)

// @ts-expect-error row primary-key matching requires the table primary-key value type
void publicWsSession.rowMatchesPrimaryKey("user", { id: "user_1" }, 1)

// @ts-expect-error row atom families require the table primary-key value type
void StdbAtom.rowAtomFamily(publicAtomSession)("user", 1)

// @ts-expect-error row refs require exactly one primary key column
void publicNoPkSession.subscribeRowRef("public_no_pk", "label")

// Multiple primary keys are rejected by module validation; this keeps the
// type-level builder invariant for hand-authored specs too.
// @ts-expect-error row refs require exactly one primary key column
void publicMultiPkSession.subscribeRowRef("public_multi_pk", "user_1")

// @ts-expect-error the public client entrypoint no longer exposes an ad-hoc HTTP factory
void StdbClient.makeHttp

// @ts-expect-error compileModule consumes an internal build-plan shape and is no longer public
void StdbCompiler.compileModule

// @ts-expect-error server authoring moved behind StdbBuilder.plan/build
void Server.make

// @ts-expect-error legacy single-handler server authoring is no longer public
void server.reducer

// @ts-expect-error legacy section-handler server authoring is no longer public
void server.handlers

// @ts-expect-error /testing no longer exposes public server authoring
void StdbTesting.makeServer

// @ts-expect-error /testing no longer exposes handler ownership internals
void StdbTesting.assertOwnedHandlerBundle

// @ts-expect-error /testing no longer exposes handler ownership internals
void StdbTesting.ServerOwnerSymbol

// @ts-expect-error the public client entrypoint no longer exposes the generated WS adapter namespace
void StdbClient.GeneratedWs

// @ts-expect-error the duplicate plan-level fetch HTTP layer was removed
void StdbClient.layerFetchFromModulePlan

// @ts-expect-error canonical projected HTTP construction is client.http.layer
void projected.client.http.layerFetch

// @ts-expect-error custom HTTP layers are rederived from lower-level primitives
void projected.client.http.layerWithHttpClient

// @ts-expect-error generated WS adapters were consolidated into client.ws.layerGenerated
void StdbClient.wsGenerated

// @ts-expect-error direct domain failures removed the old public raw catch helper
void StdbClient.catchDomainTags

// @ts-expect-error direct domain failures removed the old public flatten namespace
void StdbClient.Errors

// @ts-expect-error the public compat polyfills entrypoint was removed
void import("effect-spacetimedb/compat/polyfills")

void import("effect-spacetimedb/server-polyfills")

// @ts-expect-error the root builder plans modules; compiling build lives under server-compiler
void Stdb.StdbBuilder.build

// @ts-expect-error the canonical example module is no longer a public package export
void import("effect-spacetimedb/example-module")

// @ts-expect-error clean-break authoring removed root module(...)
void Stdb.module

// @ts-expect-error clean-break authoring removed root reducer(...)
void Stdb.reducer

// @ts-expect-error clean-break authoring removed root procedure(...)
void Stdb.procedure

// @ts-expect-error clean-break authoring removed root anonymousView(...)
void Stdb.anonymousView

// @ts-expect-error clean-break authoring removed projected server helpers
void Server.project

// @ts-expect-error projected plans no longer expose redundant callable aliases
void projected.callables

// @ts-expect-error generated WS adapter construction lives under the client entrypoint
void projected.client.ws.generated

void Stdb.StdbModule.make("public_entrypoints_module_errors_removed", {
  // @ts-expect-error module-level errors were removed
  errors: undefined,
})

// @ts-expect-error struct field internals are no longer part of the public DSL
void Stdb.field

// @ts-expect-error reducer returns alias was removed in favor of unit()
void Stdb.returns

// @ts-expect-error flat root DSL removed Module namespace exports
void Stdb.Module

// @ts-expect-error flat root DSL removed Table namespace exports
void Stdb.Table

// @ts-expect-error flat root DSL removed Type namespace exports
void Stdb.Type

// @ts-expect-error root no longer exposes internal type descriptor namespaces
void Stdb.TypeDescriptor

// @ts-expect-error root no longer exposes internal type kernel namespaces
void Stdb.TypeKernel

// @ts-expect-error root no longer exposes internal type SATS namespaces
void Stdb.TypeSats

// @ts-expect-error root no longer exposes internal type fallback namespaces
void Stdb.TypeSchemaFallback

type _CompiledModule = CompiledModule

// @ts-expect-error root entrypoint must not expose server compiler types.
type _RootCompiledModule = Stdb.CompiledModule
