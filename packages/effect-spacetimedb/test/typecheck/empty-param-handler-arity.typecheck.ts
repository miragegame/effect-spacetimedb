import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Stdb from "effect-spacetimedb"

const UserId = Stdb.string(Schema.String.pipe(Schema.brand("ArityUserId")))

const CallableArityGroup = Stdb.StdbGroup.make("CallableArity")
  .add(
    Stdb.StdbFn.reducer("empty_reducer", {
      params: Stdb.struct({}),
    }),
  )
  .add(
    Stdb.StdbFn.procedure("empty_procedure", {
      returns: Stdb.string(),
    }),
  )
  .add(
    Stdb.StdbFn.reducer("with_user", {
      params: Stdb.struct({
        userId: UserId,
      }),
    }),
  )
  .add(
    Stdb.StdbFn.procedure("lookup_user", {
      params: Stdb.struct({
        userId: UserId,
      }),
      returns: UserId,
    }),
  )
  .add(
    Stdb.StdbFn.view("empty_view", {
      returns: Stdb.array(UserId),
    }),
  )

const HttpArityGroup = Stdb.StdbHttpGroup.make("HttpArity")
  .add(
    Stdb.StdbHttp.post("empty_request", "/empty", {
      request: Schema.Struct({}),
      response: Schema.Struct({ ok: Schema.Boolean }),
    }),
  )
  .add(
    Stdb.StdbHttp.post("with_request", "/with-request", {
      request: Schema.Struct({ userId: UserId.schema }),
      response: Schema.Struct({ userId: UserId.schema }),
    }),
  )
  .add(
    Stdb.StdbHttp.post("unknown_request", "/unknown-request", {
      request: Schema.Unknown,
      response: Schema.Struct({ ok: Schema.Boolean }),
    }),
  )

const ArityModule = Stdb.StdbModule.make("empty_param_handler_arity", {})
  .add(CallableArityGroup)
  .add(HttpArityGroup)

const callableHandlers = Stdb.StdbBuilder.group(ArityModule, "CallableArity", {
  empty_reducer: () => Effect.void,
  empty_procedure: () => Effect.succeed("ok"),
  with_user: ({ userId }) => {
    void userId
    return Effect.void
  },
  lookup_user: ({ userId }) => Effect.succeed(userId),
  empty_view: () => Effect.succeed([]),
})

const httpHandlers = Stdb.StdbBuilder.group(ArityModule, "HttpArity", {
  empty_request: () => Effect.succeed({ ok: true }),
  with_request: ({ userId }) => Effect.succeed({ userId }),
  unknown_request: (payload: unknown) => {
    void payload
    return Effect.succeed({ ok: true })
  },
})

const emptyReducerPayloadArg = Stdb.StdbBuilder.group(
  ArityModule,
  "CallableArity",
  {
    // @ts-expect-error empty-param reducer handlers must not take a payload argument.
    empty_reducer: (_args: Record<string, never>) => Effect.void,
    empty_procedure: () => Effect.succeed("ok"),
    with_user: ({ userId }) => {
      void userId
      return Effect.void
    },
    lookup_user: ({ userId }) => Effect.succeed(userId),
    empty_view: () => Effect.succeed([]),
  },
)

const emptyProcedurePayloadArg = Stdb.StdbBuilder.group(
  ArityModule,
  "CallableArity",
  {
    empty_reducer: () => Effect.void,
    // @ts-expect-error empty-param procedure handlers must not take a payload argument.
    empty_procedure: (_args: Record<string, never>) => Effect.succeed("ok"),
    with_user: ({ userId }) => {
      void userId
      return Effect.void
    },
    lookup_user: ({ userId }) => Effect.succeed(userId),
    empty_view: () => Effect.succeed([]),
  },
)

const emptyViewPayloadArg = Stdb.StdbBuilder.group(
  ArityModule,
  "CallableArity",
  {
    empty_reducer: () => Effect.void,
    empty_procedure: () => Effect.succeed("ok"),
    with_user: ({ userId }) => {
      void userId
      return Effect.void
    },
    lookup_user: ({ userId }) => Effect.succeed(userId),
    // @ts-expect-error views with no payload must not take a payload argument.
    empty_view: (_args: Record<string, never>) => Effect.succeed([]),
  },
)

const emptyHttpPayloadArg = Stdb.StdbBuilder.group(ArityModule, "HttpArity", {
  // @ts-expect-error typed HTTP handlers with an empty request must not take a payload argument.
  empty_request: (_args: Record<string, never>) => Effect.succeed({ ok: true }),
  with_request: ({ userId }) => Effect.succeed({ userId }),
  unknown_request: (payload: unknown) => {
    void payload
    return Effect.succeed({ ok: true })
  },
})

const wrongNonEmptyReducerPayload = Stdb.StdbBuilder.group(
  ArityModule,
  "CallableArity",
  {
    empty_reducer: () => Effect.void,
    empty_procedure: () => Effect.succeed("ok"),
    // @ts-expect-error non-empty reducer handler payloads remain typed from params.
    with_user: ({ missing }) => {
      void missing
      return Effect.void
    },
    lookup_user: ({ userId }) => Effect.succeed(userId),
    empty_view: () => Effect.succeed([]),
  },
)

const wrongNonEmptyHttpPayload = Stdb.StdbBuilder.group(
  ArityModule,
  "HttpArity",
  {
    empty_request: () => Effect.succeed({ ok: true }),
    // @ts-expect-error non-empty typed HTTP handler payloads remain typed from request schema.
    with_request: ({ missing }) => Effect.succeed({ userId: missing }),
    unknown_request: (payload: unknown) => {
      void payload
      return Effect.succeed({ ok: true })
    },
  },
)

void callableHandlers
void httpHandlers
void emptyReducerPayloadArg
void emptyProcedurePayloadArg
void emptyViewPayloadArg
void emptyHttpPayloadArg
void wrongNonEmptyReducerPayload
void wrongNonEmptyHttpPayload
