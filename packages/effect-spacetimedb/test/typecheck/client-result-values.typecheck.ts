import * as Stdb from "effect-spacetimedb"
import type * as StdbClient from "effect-spacetimedb/client"
import {
  CallableOnlyBuilder,
  CallableOnlyModule,
} from "../fixtures/callable-only-module"
import type { Assert, IsEqual } from "./helpers"

type Results = StdbClient.ResultValuesOf<typeof CallableOnlyModule>

type _EchoResult = Assert<
  IsEqual<
    Results["echo"],
    Stdb.TypeOf<typeof CallableOnlyModule.procedures.echo.returns>
  >
>

// @ts-expect-error ResultValuesOf only includes procedures
type _NoReducerResult = Results["ping"]

// Client consumers can reach the callable utility types without importing a
// server-oriented entrypoint.
type _ProcedureSuccess = Assert<
  IsEqual<
    StdbClient.ProcedureSuccessFor<typeof CallableOnlyBuilder, "echo">,
    string
  >
>
