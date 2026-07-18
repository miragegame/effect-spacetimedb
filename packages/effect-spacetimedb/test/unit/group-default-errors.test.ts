import * as EffectVitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Stdb from "effect-spacetimedb"
import { TestLayer } from "../helpers/test-layer"

const { expect } = EffectVitest
const describe = EffectVitest.layer(TestLayer)

class GroupFailure extends Schema.TaggedErrorClass<GroupFailure>()(
  "GroupFailure",
  {},
  { httpApiStatus: 401 },
) {}

class SharedFailure extends Schema.TaggedErrorClass<SharedFailure>()(
  "SharedFailure",
  {},
  { httpApiStatus: 409 },
) {}

class EndpointFailure extends Schema.TaggedErrorClass<EndpointFailure>()(
  "EndpointFailure",
  {},
  { httpApiStatus: 422 },
) {}

describe("group default errors", (it) => {
  it.effect(
    "merges callable defaults without mutating endpoint declarations",
    () => {
      const GroupErrors = Stdb.errors(GroupFailure, SharedFailure)
      const EndpointErrors = Stdb.errors(SharedFailure, EndpointFailure)
      const FromDefault = Stdb.StdbFn.reducer("fromDefault", {
        params: Stdb.struct({}),
      })
      const WithEndpointErrors = Stdb.StdbFn.procedure("withEndpointErrors", {
        params: Stdb.struct({}),
        returns: Stdb.unit(),
        errors: EndpointErrors,
      })
      const Group = Stdb.StdbGroup.make("Calls", {
        errors: GroupErrors,
      }).add(FromDefault, WithEndpointErrors)

      expect(FromDefault.spec).not.toHaveProperty("errors")
      expect(WithEndpointErrors.spec.errors.errors).toEqual([
        SharedFailure,
        EndpointFailure,
      ])

      const spec = Stdb.StdbModule.make("group_default_errors", {}).add(
        Group,
      ).spec
      expect(spec.reducers.fromDefault.errors.errors).toEqual([
        GroupFailure,
        SharedFailure,
      ])
      expect(spec.procedures.withEndpointErrors.errors.errors).toEqual([
        GroupFailure,
        SharedFailure,
        EndpointFailure,
      ])

      return Effect.void
    },
  )

  it.effect(
    "excludes raw HTTP members and composes merged group defaults",
    () => {
      const Left = Stdb.StdbHttpGroup.make("Http", {
        errors: Stdb.errors(GroupFailure),
      }).add(
        Stdb.StdbHttp.get("rawStatus", "/raw"),
        Stdb.StdbHttp.post("leftTyped", "/left", {
          request: Schema.Struct({}),
          response: Schema.Struct({}),
        }),
      )
      const Right = Stdb.StdbHttpGroup.make("Nested", {
        errors: Stdb.errors(EndpointFailure),
      }).add(
        Stdb.StdbHttp.post("rightTyped", "/right", {
          request: Schema.Struct({}),
          response: Schema.Struct({}),
        }),
      )

      const spec = Stdb.StdbModule.make("http_group_default_errors", {}).add(
        Left.merge(Right),
      ).spec

      expect(spec.httpHandlers.rawStatus).not.toHaveProperty("errors")
      expect(spec.httpHandlers.leftTyped.errors.errors).toEqual([
        GroupFailure,
        EndpointFailure,
      ])
      expect(spec.httpHandlers.rightTyped.errors.errors).toEqual([
        GroupFailure,
        EndpointFailure,
      ])

      return Effect.void
    },
  )

  it.effect("reports conflicting classes that reuse a group error tag", () => {
    class GroupCollision extends Schema.TaggedErrorClass<GroupCollision>()(
      "Collision",
      {},
    ) {}
    class EndpointCollision extends Schema.TaggedErrorClass<EndpointCollision>()(
      "Collision",
      {},
    ) {}
    const Module = Stdb.StdbModule.make("group_error_collision", {}).add(
      Stdb.StdbGroup.make("Calls", {
        errors: Stdb.errors(GroupCollision),
      }).add(
        Stdb.StdbFn.reducer("collides", {
          errors: Stdb.errors(EndpointCollision),
        }),
      ),
    )

    expect(() => Module.spec).toThrowError(Stdb.StdbValidationError)
    try {
      void Module.spec
    } catch (error) {
      expect(error).toBeInstanceOf(Stdb.StdbValidationError)
      if (error instanceof Stdb.StdbValidationError) {
        expect(error.diagnostics).toEqual([
          expect.objectContaining({
            code: "DuplicateDeclaredErrorTag",
            path: ["reducers", "collides", "errors", "Collision"],
          }),
        ])
      }
    }

    return Effect.void
  })

  it.effect("applies typed HTTP status validation to group defaults", () => {
    class StatuslessFailure extends Schema.TaggedErrorClass<StatuslessFailure>()(
      "StatuslessFailure",
      {},
    ) {}
    const Module = Stdb.StdbModule.make("http_group_status_validation", {}).add(
      Stdb.StdbHttpGroup.make("Http", {
        errors: Stdb.errors(StatuslessFailure),
      }).add(
        Stdb.StdbHttp.post("typedStatus", "/typed", {
          request: Schema.Struct({}),
          response: Schema.Struct({}),
        }),
      ),
    )

    expect(() => Module.spec).toThrowError(Stdb.StdbValidationError)
    try {
      void Module.spec
    } catch (error) {
      expect(error).toBeInstanceOf(Stdb.StdbValidationError)
      if (error instanceof Stdb.StdbValidationError) {
        expect(error.diagnostics).toEqual([
          expect.objectContaining({
            code: "HttpRouteMissingErrorStatus",
            path: ["httpHandlers", "typedStatus", "errors"],
          }),
        ])
      }
    }

    return Effect.void
  })
})
