import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Stdb from "effect-spacetimedb"
import * as StdbClient from "effect-spacetimedb/client"
import {
  build,
  compileModule,
  type CompiledModule,
} from "effect-spacetimedb/server-compiler"
import * as Server from "effect-spacetimedb/server"
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

const Module = Stdb.StdbModule.make("public_entrypoints", {})
  .addTables(publicEntrypointsUser)
  .add(PublicViews).spec

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

const server = Server.make({ module: Module })
const projected = Stdb.project(Module)
const httpApi = Stdb.toHttpApi(Module)
const publicEntrypointIndexAlgorithm: Stdb.IndexAlgorithm = "direct"

void server
void server.dispose
void httpApi
void publicEntrypointIndexAlgorithm
void Stdb.StdbHttpProjectionError
void Stdb.httpApiBaseUrl({ uri: "http://localhost:3000/", databaseName: "db" })
void StdbClient.makeWsClient
void StdbClient.DomainCallError
void StdbClient.GeneratedWs.adapter
void Stdb.describe(PublicEntrypointString)
void Stdb.validate(Module)
void Stdb.assertValid(Module)
void Stdb.StdbBuilder.plan
void compileModule
void build
void projected.targets.tables.user
void projected.targets.allPublicTables()

// @ts-expect-error the public client entrypoint no longer exposes an ad-hoc HTTP factory
void StdbClient.makeHttp

// @ts-expect-error generated WS adapters live under Client.GeneratedWs.adapter
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

// @ts-expect-error compiler bridge types are only available from server-compiler
type _RootCompiledModule = Stdb.CompiledModule
