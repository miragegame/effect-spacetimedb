import * as StdbInternal from "effect-spacetimedb/testing/internal"
import * as Stdb from "effect-spacetimedb"
import { FullModule, MissingAuth, UserMissing } from "../fixtures/full-module"
import type { Assert, ErrorOf, IsEqual } from "./helpers"
import { makeFullModuleWsConnection } from "../helpers/ws-fixtures"
import { fixtureCallDurationMax } from "../helpers/transport-bounds"

const ws = StdbInternal.ClientWs.make({
  module: FullModule,
  connection: makeFullModuleWsConnection(),
  transport: {
    callReducerWithParams: async () => undefined,
    callProcedureWithParams: async () => undefined,
  },
})

const http = StdbInternal.ClientHttp.make({
  module: FullModule,
  uri: "http://localhost:3000",
  databaseName: "example",
  callDurationMax: fixtureCallDurationMax,
  token: "example-token",
})

type ExpectedFailure = StdbInternal.CallFailure<MissingAuth | UserMissing>
type ExpectedWsFailure = StdbInternal.WsCallFailure<MissingAuth | UserMissing>

type HttpReducerError = ErrorOf<ReturnType<typeof http.reducers.userRequire>>
type HttpProcedureError = ErrorOf<ReturnType<typeof http.procedures.userGet>>
type GroupedHttpProcedureError = ErrorOf<
  ReturnType<typeof http.groups.FullCallables.procedures.userGet>
>
type WsReducerError = ErrorOf<ReturnType<typeof ws.reducers.userRequire>>
type WsProcedureError = ErrorOf<ReturnType<typeof ws.procedures.userGet>>
type HttpReducerWithoutDeclaredError = ErrorOf<
  ReturnType<typeof http.reducers.userUpsert>
>
type WsReducerWithoutDeclaredError = ErrorOf<
  ReturnType<typeof ws.reducers.userUpsert>
>
type HttpRawProcedureError = ErrorOf<
  ReturnType<typeof http.procedures.userGet.raw>
>
type WsRawProcedureError = ErrorOf<ReturnType<typeof ws.procedures.userGet.raw>>

type DirectDomainErrorOf<Failure> = Extract<Failure, MissingAuth | UserMissing>

type RawDomainErrorOf<Failure> = Extract<
  Failure,
  { readonly error: unknown }
> extends {
  readonly error: infer Error
}
  ? Error
  : never

type ConnectionFailureOf<Failure> = Extract<Failure, Stdb.WsConnectionFailure>

// An HTTP call has no connection to lose, so nothing to catch for one.
type _HttpReducerConnectionFailure = Assert<
  IsEqual<ConnectionFailureOf<HttpReducerError>, never>
>
type _HttpProcedureConnectionFailure = Assert<
  IsEqual<ConnectionFailureOf<HttpProcedureError>, never>
>
type _GroupedHttpProcedureConnectionFailure = Assert<
  IsEqual<ConnectionFailureOf<GroupedHttpProcedureError>, never>
>
type _HttpRawProcedureConnectionFailure = Assert<
  IsEqual<ConnectionFailureOf<HttpRawProcedureError>, never>
>
type _WsReducerConnectionFailure = Assert<
  IsEqual<ConnectionFailureOf<WsReducerError>, Stdb.WsConnectionFailure>
>
type _WsProcedureConnectionFailure = Assert<
  IsEqual<ConnectionFailureOf<WsProcedureError>, Stdb.WsConnectionFailure>
>
type _WsRawProcedureConnectionFailure = Assert<
  IsEqual<ConnectionFailureOf<WsRawProcedureError>, Stdb.WsConnectionFailure>
>

type _HttpReducerError = Assert<
  IsEqual<DirectDomainErrorOf<HttpReducerError>, MissingAuth | UserMissing>
>
type _WsReducerError = Assert<
  IsEqual<DirectDomainErrorOf<WsReducerError>, MissingAuth | UserMissing>
>
type _GroupedHttpProcedureError = Assert<
  IsEqual<
    DirectDomainErrorOf<GroupedHttpProcedureError>,
    MissingAuth | UserMissing
  >
>
type _HttpReducerWithoutDeclaredError = Assert<
  IsEqual<DirectDomainErrorOf<HttpReducerWithoutDeclaredError>, never>
>
type _WsReducerWithoutDeclaredError = Assert<
  IsEqual<DirectDomainErrorOf<WsReducerWithoutDeclaredError>, never>
>
type _HttpRawProcedureError = Assert<
  IsEqual<RawDomainErrorOf<HttpRawProcedureError>, MissingAuth | UserMissing>
>
type _WsRawProcedureError = Assert<
  IsEqual<RawDomainErrorOf<WsRawProcedureError>, MissingAuth | UserMissing>
>

declare const httpReducerError: HttpReducerError
declare const httpProcedureError: HttpProcedureError
declare const wsReducerError: WsReducerError
declare const wsProcedureError: WsProcedureError
declare const httpProcedureDomainError: DirectDomainErrorOf<HttpProcedureError>
declare const wsProcedureDomainError: DirectDomainErrorOf<WsProcedureError>

const _httpReducer: ExpectedFailure = httpReducerError
const _httpProcedure: ExpectedFailure = httpProcedureError
const _wsReducer: ExpectedWsFailure = wsReducerError
const _wsProcedure: ExpectedWsFailure = wsProcedureError
const _httpProcedureDomain: MissingAuth | UserMissing = httpProcedureDomainError
const _wsProcedureDomain: MissingAuth | UserMissing = wsProcedureDomainError

const ArrayErrorModule = Stdb.Module.make("client_array_errors", {}).add(
  Stdb.Group.make("Calls").add(
    Stdb.Fn.procedure("arrayErrorCall", {
      returns: Stdb.unit(),
      errors: [Stdb.errors(MissingAuth), UserMissing],
    }),
  ),
).spec

const arrayHttp = StdbInternal.ClientHttp.make({
  module: ArrayErrorModule,
  uri: "http://localhost:3000",
  databaseName: "client_array_errors",
  callDurationMax: fixtureCallDurationMax,
  token: "example-token",
})
type ArrayHttpProcedureError = ErrorOf<
  ReturnType<typeof arrayHttp.procedures.arrayErrorCall>
>
type _ArrayHttpProcedureError = Assert<
  IsEqual<
    DirectDomainErrorOf<ArrayHttpProcedureError>,
    MissingAuth | UserMissing
  >
>

void 0
