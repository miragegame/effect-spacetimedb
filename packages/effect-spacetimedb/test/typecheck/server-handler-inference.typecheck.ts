import * as Effect from "effect/Effect"
import * as Stdb from "effect-spacetimedb"
import { CallableOnlyBuilder } from "../fixtures/callable-only-module"
import type { Assert, ErrorOf, Expand, IsEqual } from "./helpers"

const inferredHandlers = Stdb.Builder.group(
  CallableOnlyBuilder,
  "CallableOnly",
  {
    ping: () => Effect.void,
    echo: (args) => {
      type _EchoArgs = Assert<
        IsEqual<Expand<typeof args>, { readonly value: string }>
      >
      return Effect.succeed("ok")
    },
  },
)

type _ReducerCtxNever = Assert<
  IsEqual<ErrorOf<typeof CallableOnlyBuilder.ReducerCtx>, never>
>
type _ProcedureCtxNever = Assert<
  IsEqual<ErrorOf<typeof CallableOnlyBuilder.ProcedureCtx>, never>
>
type _DbNever = Assert<IsEqual<ErrorOf<typeof CallableOnlyBuilder.Db>, never>>
type _TxCtxNever = Assert<
  IsEqual<ErrorOf<typeof CallableOnlyBuilder.TxCtx>, never>
>

void inferredHandlers
