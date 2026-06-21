import * as StdbTesting from "effect-spacetimedb/testing"
import * as Stdb from "effect-spacetimedb"
import { FullModule, MissingAuth, UserMissing } from "../fixtures/full-module"
import type { Assert, ErrorOf, IsEqual } from "./helpers"
import { makeFullModuleWsConnection } from "../helpers/ws-fixtures"

const ws = StdbTesting.ClientWs.make({
  module: FullModule,
  connection: makeFullModuleWsConnection(),
  transport: {
    callReducerWithParams: async () => undefined,
    callProcedureWithParams: async () => undefined,
  },
})

const http = StdbTesting.ClientHttp.make({
  module: FullModule,
  uri: "http://localhost:3000",
  databaseName: "example",
  token: "example-token",
})

type ExpectedFailure = StdbTesting.CallFailure<MissingAuth | UserMissing>

type HttpReducerError = ErrorOf<ReturnType<typeof http.reducers.userRequire>>
type HttpProcedureError = ErrorOf<ReturnType<typeof http.procedures.userGet>>
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

type _HttpReducerError = Assert<
  IsEqual<DirectDomainErrorOf<HttpReducerError>, MissingAuth | UserMissing>
>
type _WsReducerError = Assert<
  IsEqual<DirectDomainErrorOf<WsReducerError>, MissingAuth | UserMissing>
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
const _wsReducer: ExpectedFailure = wsReducerError
const _wsProcedure: ExpectedFailure = wsProcedureError
const _httpProcedureDomain: MissingAuth | UserMissing = httpProcedureDomainError
const _wsProcedureDomain: MissingAuth | UserMissing = wsProcedureDomainError

const ArrayErrorModule = Stdb.StdbModule.make("client_array_errors", {}).add(
  Stdb.StdbGroup.make("Calls").add(
    Stdb.StdbFn.procedure("arrayErrorCall", {
      returns: Stdb.unit(),
      errors: [Stdb.errors(MissingAuth), UserMissing],
    }),
  ),
).spec

const arrayHttp = StdbTesting.ClientHttp.make({
  module: ArrayErrorModule,
  uri: "http://localhost:3000",
  databaseName: "client_array_errors",
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
