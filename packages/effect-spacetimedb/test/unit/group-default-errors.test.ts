import * as EffectVitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Stdb from "effect-spacetimedb"
import { TestLayer } from "../helpers/test-layer"

const { expect } = EffectVitest
const describe = EffectVitest.layer(TestLayer)

class GroupFailure extends Schema.TaggedError<GroupFailure>()(
  "GroupFailure",
  {},
  { httpApiStatus: 401 },
) {}

class SharedFailure extends Schema.TaggedError<SharedFailure>()(
  "SharedFailure",
  {},
  { httpApiStatus: 409 },
) {}

class EndpointFailure extends Schema.TaggedError<EndpointFailure>()(
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
      const FromDefault = Stdb.Fn.reducer("fromDefault", {
        params: Stdb.struct({}),
      })
      const WithEndpointErrors = Stdb.Fn.procedure("withEndpointErrors", {
        params: Stdb.struct({}),
        returns: Stdb.unit(),
        errors: EndpointErrors,
      })
      const Group = Stdb.Group.make("Calls", {
        errors: GroupErrors,
      }).add(FromDefault, WithEndpointErrors)

      expect(FromDefault.spec).not.toHaveProperty("errors")
      expect(WithEndpointErrors.spec.errors.errors).toEqual([
        SharedFailure,
        EndpointFailure,
      ])

      const spec = Stdb.Module.make("group_default_errors", {}).add(Group).spec
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
      const Left = Stdb.HttpGroup.make("Http", {
        errors: Stdb.errors(GroupFailure),
      }).add(
        Stdb.Http.get("rawStatus", "/raw"),
        Stdb.Http.post("leftTyped", "/left", {
          request: Schema.Struct({}),
          response: Schema.Struct({}),
        }),
      )
      const Right = Stdb.HttpGroup.make("Nested", {
        errors: Stdb.errors(EndpointFailure),
      }).add(
        Stdb.Http.post("rightTyped", "/right", {
          request: Schema.Struct({}),
          response: Schema.Struct({}),
        }),
      )

      const spec = Stdb.Module.make("http_group_default_errors", {}).add(
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
    // The tag is deliberately reused across two classes; that collision is
    // what this test asserts the registry detects.
    class GroupCollision extends Schema.TaggedError<GroupCollision>()(
      "Collision",
      {},
    ) {}
    // Deliberate duplicate of the tag above, per this test.
    class EndpointCollision extends Schema.TaggedError<EndpointCollision>()(
      "Collision",
      {},
    ) {}
    const Module = Stdb.Module.make("group_error_collision", {}).add(
      Stdb.Group.make("Calls", {
        errors: Stdb.errors(GroupCollision),
      }).add(
        Stdb.Fn.reducer("collides", {
          errors: Stdb.errors(EndpointCollision),
        }),
      ),
    )

    expect(() => Module.spec).toThrowError(Stdb.StdbValidationDefect)
    try {
      void Module.spec
    } catch (error) {
      expect(error).toBeInstanceOf(Stdb.StdbValidationDefect)
      if (error instanceof Stdb.StdbValidationDefect) {
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
    class StatuslessFailure extends Schema.TaggedError<StatuslessFailure>()(
      "StatuslessFailure",
      {},
    ) {}
    const Module = Stdb.Module.make("http_group_status_validation", {}).add(
      Stdb.HttpGroup.make("Http", {
        errors: Stdb.errors(StatuslessFailure),
      }).add(
        Stdb.Http.post("typedStatus", "/typed", {
          request: Schema.Struct({}),
          response: Schema.Struct({}),
        }),
      ),
    )

    expect(() => Module.spec).toThrowError(Stdb.StdbValidationDefect)
    try {
      void Module.spec
    } catch (error) {
      expect(error).toBeInstanceOf(Stdb.StdbValidationDefect)
      if (error instanceof Stdb.StdbValidationDefect) {
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
