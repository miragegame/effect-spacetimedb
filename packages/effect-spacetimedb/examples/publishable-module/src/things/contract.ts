import * as Schema from "effect/Schema"
import * as Stdb from "effect-spacetimedb"
import { ExampleErrors } from "../errors"
import { ThingId, thing, U64 } from "../schema"

export const ThingPingInput = Schema.Struct({
  thingId: ThingId,
})

export const ThingPingOutput = Schema.Struct({
  thingId: ThingId,
  status: Schema.Literal("ok"),
})

export const ThingFunctions = Stdb.Group.make("Things")
  .add(
    Stdb.Fn.reducer("thingSet", {
      params: Stdb.struct({
        thingId: Stdb.string(ThingId),
        label: Stdb.string(),
        count: U64,
      }),
    }),
  )
  .add(
    Stdb.Fn.reducer("thingDelete", {
      params: Stdb.struct({
        thingId: Stdb.string(ThingId),
      }),
    }),
  )
  .add(
    Stdb.Fn.reducer("thingNoop", {
      params: Stdb.struct({}),
    }),
  )
  .add(
    Stdb.Fn.reducer("thingPanic", {
      params: Stdb.struct({}),
    }),
  )
  .add(
    Stdb.Fn.reducer("thingClear", {
      params: Stdb.struct({}),
    }),
  )
  .add(
    Stdb.Fn.reducer("thingForceUpdate", {
      params: Stdb.struct({
        thingId: Stdb.string(ThingId),
        label: Stdb.string(),
        count: U64,
      }),
    }),
  )
  .add(
    Stdb.Fn.reducer("thingInsertThenAbort", {
      params: Stdb.struct({
        thingId: Stdb.string(ThingId),
        label: Stdb.string(),
        count: U64,
      }),
      errors: ExampleErrors,
    }),
  )
  .add(
    Stdb.Fn.reducer("thingInsertTwiceAtomic", {
      params: Stdb.struct({
        firstThingId: Stdb.string(ThingId),
        firstLabel: Stdb.string(),
        firstCount: U64,
        secondThingId: Stdb.string(ThingId),
        secondLabel: Stdb.string(),
        secondCount: U64,
      }),
    }),
  )
  .add(
    Stdb.Fn.reducer("thingInsertTwiceThenAbort", {
      params: Stdb.struct({
        firstThingId: Stdb.string(ThingId),
        firstLabel: Stdb.string(),
        firstCount: U64,
        secondThingId: Stdb.string(ThingId),
        secondLabel: Stdb.string(),
        secondCount: U64,
      }),
      errors: ExampleErrors,
    }),
  )
  .add(
    Stdb.Fn.procedure("thingGet", {
      params: Stdb.struct({
        thingId: Stdb.string(ThingId),
      }),
      returns: Stdb.option(thing.row),
    }),
  )
  .add(
    Stdb.Fn.procedure("thingCount", {
      params: Stdb.struct({}),
      returns: U64,
    }),
  )
  .add(
    Stdb.Fn.procedure("thingList", {
      params: Stdb.struct({}),
      returns: Stdb.array(thing.row),
    }),
  )
  .add(
    Stdb.Fn.procedure("thingByCountExact", {
      params: Stdb.struct({
        count: U64,
      }),
      returns: Stdb.array(thing.row),
    }),
  )
  .add(
    Stdb.Fn.procedure("thingByCountRange", {
      params: Stdb.struct({
        lo: U64,
        hi: U64,
      }),
      returns: Stdb.array(thing.row),
    }),
  )
  .add(
    Stdb.Fn.procedure("thingByCountRangeExclusive", {
      params: Stdb.struct({
        lo: U64,
        hi: U64,
      }),
      returns: Stdb.array(thing.row),
    }),
  )
  .add(
    Stdb.Fn.procedure("thingInsertTwiceInTx", {
      params: Stdb.struct({
        firstThingId: Stdb.string(ThingId),
        firstLabel: Stdb.string(),
        firstCount: U64,
        secondThingId: Stdb.string(ThingId),
        secondLabel: Stdb.string(),
        secondCount: U64,
      }),
      returns: Stdb.unit(),
    }),
  )
  .add(
    Stdb.Fn.procedure("thingInsertInTxThenAbort", {
      params: Stdb.struct({
        thingId: Stdb.string(ThingId),
        label: Stdb.string(),
        count: U64,
      }),
      returns: Stdb.unit(),
      errors: ExampleErrors,
    }),
  )
  .add(
    Stdb.Fn.procedure("thingOutcome", {
      params: Stdb.struct({
        thingId: Stdb.string(ThingId),
      }),
      returns: Stdb.result(thing.row, Stdb.string()),
    }),
  )
  .add(
    Stdb.Fn.anonymousView("allThings", {
      returns: Stdb.array(thing.row),
    }),
  )

export const ThingRoutes = Stdb.HttpGroup.make("ThingHttp")
  .prefix("/things")
  .add(
    Stdb.Http.post("thingPing", "/ping", {
      request: ThingPingInput,
      response: ThingPingOutput,
    }),
  )
