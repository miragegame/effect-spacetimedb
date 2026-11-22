import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Stdb from "effect-spacetimedb"
import { testViewRowsLength } from "../helpers/array-bounds"

const UserId = Stdb.string(Schema.String.pipe(Schema.brand("ArityUserId")))

const CallableArityGroup = Stdb.Group.make("CallableArity")
  .add(
    Stdb.Fn.reducer("empty_reducer", {
      params: Stdb.struct({}),
    }),
  )
  .add(
    Stdb.Fn.procedure("empty_procedure", {
      returns: Stdb.string(),
    }),
  )
  .add(
    Stdb.Fn.reducer("with_user", {
      params: Stdb.struct({
        userId: UserId,
      }),
    }),
  )
  .add(
    Stdb.Fn.procedure("lookup_user", {
      params: Stdb.struct({
        userId: UserId,
      }),
      returns: UserId,
    }),
  )
  .add(
    Stdb.Fn.view("empty_view", {
      returns: Stdb.array(UserId, testViewRowsLength),
    }),
  )

const HttpArityGroup = Stdb.HttpGroup.make("HttpArity")
  .add(
    Stdb.Http.post("empty_request", "/empty", {
      request: Schema.Struct({}),
      response: Schema.Struct({ ok: Schema.Boolean }),
    }),
  )
  .add(
    Stdb.Http.post("with_request", "/with-request", {
      request: Schema.Struct({ userId: UserId.schema }),
      response: Schema.Struct({ userId: UserId.schema }),
    }),
  )
  .add(
    Stdb.Http.post("unknown_request", "/unknown-request", {
      request: Schema.Unknown,
      response: Schema.Struct({ ok: Schema.Boolean }),
    }),
  )

const ArityModule = Stdb.Module.make("empty_param_handler_arity", {})
  .add(CallableArityGroup)
  .add(HttpArityGroup)

const callableHandlers = Stdb.Builder.group(ArityModule, "CallableArity", {
  empty_reducer: () => Effect.void,
  empty_procedure: () => Effect.succeed("ok"),
  with_user: ({ userId }) => {
    void userId
    return Effect.void
  },
  lookup_user: ({ userId }) => Effect.succeed(userId),
  empty_view: () => Effect.succeed([]),
})

const httpHandlers = Stdb.Builder.group(ArityModule, "HttpArity", {
  empty_request: () => Effect.succeed({ ok: true }),
  with_request: ({ userId }) => Effect.succeed({ userId }),
  unknown_request: (payload: unknown) => {
    void payload
    return Effect.succeed({ ok: true })
  },
})

const emptyReducerPayloadArg = Stdb.Builder.group(
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

const emptyProcedurePayloadArg = Stdb.Builder.group(
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

const emptyViewPayloadArg = Stdb.Builder.group(ArityModule, "CallableArity", {
  empty_reducer: () => Effect.void,
  empty_procedure: () => Effect.succeed("ok"),
  with_user: ({ userId }) => {
    void userId
    return Effect.void
  },
  lookup_user: ({ userId }) => Effect.succeed(userId),
  // @ts-expect-error views with no payload must not take a payload argument.
  empty_view: (_args: Record<string, never>) => Effect.succeed([]),
})

const emptyHttpPayloadArg = Stdb.Builder.group(ArityModule, "HttpArity", {
  // @ts-expect-error typed HTTP handlers with an empty request must not take a payload argument.
  empty_request: (_args: Record<string, never>) => Effect.succeed({ ok: true }),
  with_request: ({ userId }) => Effect.succeed({ userId }),
  unknown_request: (payload: unknown) => {
    void payload
    return Effect.succeed({ ok: true })
  },
})

const wrongNonEmptyReducerPayload = Stdb.Builder.group(
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

const wrongNonEmptyHttpPayload = Stdb.Builder.group(ArityModule, "HttpArity", {
  empty_request: () => Effect.succeed({ ok: true }),
  // @ts-expect-error non-empty typed HTTP handler payloads remain typed from request schema.
  with_request: ({ missing }) => Effect.succeed({ userId: missing }),
  unknown_request: (payload: unknown) => {
    void payload
    return Effect.succeed({ ok: true })
  },
})

void callableHandlers
void httpHandlers
void emptyReducerPayloadArg
void emptyProcedurePayloadArg
void emptyViewPayloadArg
void emptyHttpPayloadArg
void wrongNonEmptyReducerPayload
void wrongNonEmptyHttpPayload
