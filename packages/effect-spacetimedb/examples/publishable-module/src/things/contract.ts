import * as Schema from "effect/Schema"
import * as Stdb from "effect-spacetimedb"
import { String255, ThingId, thing, U64 } from "../schema"

export const ThingPingInput = Schema.Struct({
  thingId: ThingId,
})

export const ThingPingOutput = Schema.Struct({
  thingId: ThingId,
  status: Schema.Literal("ok"),
})

export const ThingFunctions = Stdb.StdbGroup.make("Things")
  .add(
    Stdb.StdbFn.reducer("thingSet", {
      params: Stdb.struct({
        thingId: Stdb.string(ThingId),
        label: String255,
        count: U64,
      }),
    }),
  )
  .add(
    Stdb.StdbFn.reducer("thingDelete", {
      params: Stdb.struct({
        thingId: Stdb.string(ThingId),
      }),
    }),
  )
  .add(
    Stdb.StdbFn.reducer("thingNoop", {
      params: Stdb.struct({}),
    }),
  )
  .add(
    Stdb.StdbFn.reducer("thingPanic", {
      params: Stdb.struct({}),
    }),
  )
  .add(
    Stdb.StdbFn.procedure("thingGet", {
      params: Stdb.struct({
        thingId: Stdb.string(ThingId),
      }),
      returns: Stdb.option(thing.row),
    }),
  )
  .add(
    Stdb.StdbFn.procedure("thingOutcome", {
      params: Stdb.struct({
        thingId: Stdb.string(ThingId),
      }),
      returns: Stdb.result(thing.row, String255),
    }),
  )
  .add(
    Stdb.StdbFn.anonymousView("allThings", {
      returns: Stdb.array(thing.row),
    }),
  )

export const ThingRoutes = Stdb.StdbHttpGroup.make("ThingHttp")
  .prefix("/things")
  .add(
    Stdb.StdbHttp.post("thingPing", "/ping", {
      request: ThingPingInput,
      response: ThingPingOutput,
    }),
  )
