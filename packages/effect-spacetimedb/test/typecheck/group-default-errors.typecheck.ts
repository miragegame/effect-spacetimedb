import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Stdb from "effect-spacetimedb"
import * as StdbClient from "effect-spacetimedb/client"
import type { Assert, IsEqual } from "./helpers"

class GroupFailure extends Schema.TaggedErrorClass<GroupFailure>()(
  "GroupFailure",
  {},
  { httpApiStatus: 401 },
) {}

class EndpointFailure extends Schema.TaggedErrorClass<EndpointFailure>()(
  "EndpointFailure",
  {},
  { httpApiStatus: 422 },
) {}

class UndeclaredFailure extends Schema.TaggedErrorClass<UndeclaredFailure>()(
  "UndeclaredFailure",
  {},
) {}

const Calls = Stdb.StdbGroup.make("Calls", {
  errors: Stdb.errors(GroupFailure),
}).add(
  Stdb.StdbFn.reducer("fromDefault", {}),
  Stdb.StdbFn.procedure("withEndpoint", {
    returns: Stdb.unit(),
    errors: Stdb.errors(EndpointFailure),
  }),
)

const Http = Stdb.StdbHttpGroup.make("Http", {
  errors: Stdb.errors(GroupFailure),
}).add(
  Stdb.StdbHttp.get("rawRoute", "/raw"),
  Stdb.StdbHttp.post("typedRoute", "/typed", {
    request: Schema.Struct({}),
    response: Schema.Struct({}),
    errors: Stdb.errors(EndpointFailure),
  }),
)

const Module = Stdb.StdbModule.make("group_default_typecheck", {}).add(
  Calls,
  Http,
)

type ReducerDomainErrors = Extract<
  StdbClient.ReducerErrorsFor<typeof Module, "fromDefault">,
  GroupFailure | EndpointFailure
>
type ProcedureDomainErrors = Extract<
  StdbClient.ProcedureErrorsFor<typeof Module, "withEndpoint">,
  GroupFailure | EndpointFailure
>
type RawHttpDomainErrors = Extract<
  StdbClient.HttpHandlerErrorsFor<typeof Module, "rawRoute">,
  GroupFailure | EndpointFailure
>
type TypedHttpDomainErrors = Extract<
  StdbClient.HttpHandlerErrorsFor<typeof Module, "typedRoute">,
  GroupFailure | EndpointFailure
>

type _reducerGetsGroupDefault = Assert<
  IsEqual<ReducerDomainErrors, GroupFailure>
>
type _procedureMergesGroupAndEndpoint = Assert<
  IsEqual<ProcedureDomainErrors, GroupFailure | EndpointFailure>
>
type _rawHttpExcludesGroupDefault = Assert<IsEqual<RawHttpDomainErrors, never>>
type _typedHttpMergesGroupAndEndpoint = Assert<
  IsEqual<TypedHttpDomainErrors, GroupFailure | EndpointFailure>
>

void Stdb.StdbBuilder.group(Module, "Calls", {
  fromDefault: () => Effect.fail(GroupFailure.make({})),
  withEndpoint: () => Effect.fail(EndpointFailure.make({})),
})

void Stdb.StdbBuilder.group(
  Module,
  "Calls",
  {
    fromDefault: () => Effect.void,
    withEndpoint: () => Effect.void,
  },
  { middleware: Effect.fail(GroupFailure.make({})) },
)

const Mixed = Stdb.StdbGroup.make("Mixed", {
  errors: Stdb.errors(GroupFailure),
}).add(
  Stdb.StdbFn.reducer("mixedReduce", {}),
  Stdb.StdbFn.anonymousView("mixedView", { returns: Stdb.unit() }),
)
const MixedModule = Stdb.StdbModule.make("mixed_group_middleware", {}).add(
  Mixed,
)

void Stdb.StdbBuilder.group(
  MixedModule,
  "Mixed",
  {
    mixedReduce: () => Effect.void,
    mixedView: () => Effect.void,
  },
  {
    middleware: MixedModule.ReducerCtx.pipe(
      Effect.andThen(Effect.fail(GroupFailure.make({}))),
    ),
  },
)

void Stdb.StdbBuilder.group(
  Module,
  "Calls",
  {
    fromDefault: () => Effect.void,
    withEndpoint: () => Effect.void,
  },
  {
    middleware: {
      reducers: Module.ReducerCtx.pipe(Effect.asVoid),
      procedures: Effect.void,
    },
  },
)

void Stdb.StdbBuilder.group(
  Module,
  "Calls",
  {
    fromDefault: () => Effect.void,
    withEndpoint: () => Effect.void,
  },
  // @ts-expect-error shorthand reducer context is forbidden for the procedure member.
  { middleware: Module.ReducerCtx.pipe(Effect.asVoid) },
)

void Stdb.StdbBuilder.group(
  Module,
  "Calls",
  {
    fromDefault: () => Effect.void,
    withEndpoint: () => Effect.void,
  },
  // @ts-expect-error middleware failures must be declared by every affected member.
  { middleware: Effect.fail(UndeclaredFailure.make({})) },
)

void Stdb.StdbBuilder.group(
  Module,
  "Http",
  {
    rawRoute: (_request) => Effect.succeed(new Stdb.SyncResponse()),
    typedRoute: () => Effect.succeed({}),
  },
  // @ts-expect-error raw HTTP members require infallible middleware.
  { middleware: { httpHandlers: Effect.fail(GroupFailure.make({})) } },
)

// @ts-expect-error handler failures must remain within the post-merge declaration.
void Stdb.StdbBuilder.group(Module, "Calls", {
  fromDefault: () => Effect.fail(UndeclaredFailure.make({})),
  withEndpoint: () => Effect.void,
})

void 0
