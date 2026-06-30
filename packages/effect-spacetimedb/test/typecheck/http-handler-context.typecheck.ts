import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Stdb from "effect-spacetimedb"
import { build } from "effect-spacetimedb/server-compiler"

const HttpTypecheckFunctions = Stdb.StdbGroup.make("Functions")
  .add(
    Stdb.StdbFn.reducer("ping", {
      params: Stdb.struct({}),
    }),
  )
  .add(
    Stdb.StdbFn.procedure("echo", {
      params: Stdb.struct({
        message: Stdb.string(),
      }),
      returns: Stdb.string(),
    }),
  )

const HttpTypecheckRoutes = Stdb.StdbHttpGroup.make("Http")
  .add(Stdb.StdbHttp.post("raw", "/raw"))
  .add(
    Stdb.StdbHttp.post("typed", "/typed", {
      request: Schema.Struct({ message: Schema.String }),
      response: Schema.Struct({ message: Schema.String }),
    }),
  )

const HttpTypecheckModule = Stdb.StdbModule.make("http_typecheck", {})
  .add(HttpTypecheckFunctions)
  .add(HttpTypecheckRoutes)

const { Db, Http, HttpHandlerCtx, HttpTx, ReducerCtx, Tx } = HttpTypecheckModule

const functionHandlers = Stdb.StdbBuilder.group(
  HttpTypecheckModule,
  "Functions",
  {
    ping: () => Effect.void,
    echo: ({ message }) => Effect.succeed(message),
  },
)

const httpHandlers = Stdb.StdbBuilder.group(HttpTypecheckModule, "Http", {
  raw: Effect.fn(function* (_request: Stdb.Request) {
    const ctx = yield* HttpHandlerCtx
    const http = yield* Http
    void ctx.http
    void http.fetch
    return new Stdb.SyncResponse("ok", { status: 201 })
  }),
  typed: Effect.fn(function* ({ message }) {
    const httpTx = yield* HttpTx
    const ctx = yield* HttpHandlerCtx
    void ctx.http
    return yield* httpTx.run(
      Effect.gen(function* () {
        const db = yield* Db
        void db
        return { message }
      }),
    )
  }),
})

void build(HttpTypecheckModule, [functionHandlers, httpHandlers])

const bareDbForbidden = Stdb.StdbBuilder.group(HttpTypecheckModule, "Http", {
  raw: (_request: Stdb.Request) => Effect.succeed(new Stdb.SyncResponse("ok")),
  // @ts-expect-error HTTP handlers cannot require Db outside HttpTx.run
  typed: () =>
    Effect.gen(function* () {
      yield* Db
      return { message: "ok" }
    }),
})
void bareDbForbidden

const txForbidden = Stdb.StdbBuilder.group(HttpTypecheckModule, "Http", {
  raw: (_request: Stdb.Request) => Effect.succeed(new Stdb.SyncResponse("ok")),
  // @ts-expect-error HTTP handlers use HttpTx, not the procedure Tx runner
  typed: () =>
    Effect.gen(function* () {
      yield* Tx
      return { message: "ok" }
    }),
})
void txForbidden

const reducerCannotUseHttpHandlerCtx = Stdb.StdbBuilder.group(
  HttpTypecheckModule,
  "Functions",
  {
    // @ts-expect-error reducers must not access HttpHandlerCtx
    ping: () => HttpHandlerCtx,
    echo: ({ message }) => Effect.succeed(message),
  },
)
void reducerCannotUseHttpHandlerCtx

const procedureCannotUseHttpHandlerCtx = Stdb.StdbBuilder.group(
  HttpTypecheckModule,
  "Functions",
  {
    ping: () => Effect.void,
    // @ts-expect-error procedures must not access HttpHandlerCtx
    echo: () =>
      Effect.gen(function* () {
        yield* HttpHandlerCtx
        return "ok"
      }),
  },
)
void procedureCannotUseHttpHandlerCtx

void ReducerCtx
