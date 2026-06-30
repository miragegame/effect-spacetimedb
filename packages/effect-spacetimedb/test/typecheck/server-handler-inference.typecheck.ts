import * as Effect from "effect/Effect"
import * as StdbTesting from "effect-spacetimedb/testing"
import { CallableOnlyModule } from "../fixtures/callable-only-module"
import type { Assert, ErrorOf, Expand, IsEqual } from "./helpers"

const server = StdbTesting.makeServer({ module: CallableOnlyModule })

const inferredHandlers = server.handlers({
  reducers: {
    ping: (args) => {
      type _PingArgs = Assert<IsEqual<Expand<typeof args>, {}>>
      return Effect.void
    },
  },
  procedures: {
    echo: (args) => {
      type _EchoArgs = Assert<
        IsEqual<Expand<typeof args>, { readonly value: string }>
      >
      return Effect.succeed("ok")
    },
  },
})

type _ReducerCtxNever = Assert<
  IsEqual<ErrorOf<typeof server.reducerCtx>, never>
>
type _ProcedureCtxNever = Assert<
  IsEqual<ErrorOf<typeof server.procedureCtx>, never>
>
type _DbNever = Assert<IsEqual<ErrorOf<typeof server.db>, never>>
type _TxCtxNever = Assert<IsEqual<ErrorOf<typeof server.txCtx>, never>>

void inferredHandlers
