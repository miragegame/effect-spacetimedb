import * as Schema from "effect/Schema"
import * as Stdb from "effect-spacetimedb"
import { ExampleErrors } from "../errors"
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
    Stdb.StdbFn.reducer("thingClear", {
      params: Stdb.struct({}),
    }),
  )
  .add(
    Stdb.StdbFn.reducer("thingForceUpdate", {
      params: Stdb.struct({
        thingId: Stdb.string(ThingId),
        label: String255,
        count: U64,
      }),
    }),
  )
  .add(
    Stdb.StdbFn.reducer("thingInsertThenAbort", {
      params: Stdb.struct({
        thingId: Stdb.string(ThingId),
        label: String255,
        count: U64,
      }),
      errors: ExampleErrors,
    }),
  )
  .add(
    Stdb.StdbFn.reducer("thingInsertTwiceAtomic", {
      params: Stdb.struct({
        firstThingId: Stdb.string(ThingId),
        firstLabel: String255,
        firstCount: U64,
        secondThingId: Stdb.string(ThingId),
        secondLabel: String255,
        secondCount: U64,
      }),
    }),
  )
  .add(
    Stdb.StdbFn.reducer("thingInsertTwiceThenAbort", {
      params: Stdb.struct({
        firstThingId: Stdb.string(ThingId),
        firstLabel: String255,
        firstCount: U64,
        secondThingId: Stdb.string(ThingId),
        secondLabel: String255,
        secondCount: U64,
      }),
      errors: ExampleErrors,
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
    Stdb.StdbFn.procedure("thingCount", {
      params: Stdb.struct({}),
      returns: U64,
    }),
  )
  .add(
    Stdb.StdbFn.procedure("thingList", {
      params: Stdb.struct({}),
      returns: Stdb.array(thing.row),
    }),
  )
  .add(
    Stdb.StdbFn.procedure("thingByCountExact", {
      params: Stdb.struct({
        count: U64,
      }),
      returns: Stdb.array(thing.row),
    }),
  )
  .add(
    Stdb.StdbFn.procedure("thingByCountRange", {
      params: Stdb.struct({
        lo: U64,
        hi: U64,
      }),
      returns: Stdb.array(thing.row),
    }),
  )
  .add(
    Stdb.StdbFn.procedure("thingInsertTwiceInTx", {
      params: Stdb.struct({
        firstThingId: Stdb.string(ThingId),
        firstLabel: String255,
        firstCount: U64,
        secondThingId: Stdb.string(ThingId),
        secondLabel: String255,
        secondCount: U64,
      }),
      returns: Stdb.unit(),
    }),
  )
  .add(
    Stdb.StdbFn.procedure("thingInsertInTxThenAbort", {
      params: Stdb.struct({
        thingId: Stdb.string(ThingId),
        label: String255,
        count: U64,
      }),
      returns: Stdb.unit(),
      errors: ExampleErrors,
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
