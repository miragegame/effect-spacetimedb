import * as Stdb from "effect-spacetimedb"
import { String255, U64 } from "../schema"

export const NativeRangeFunctions = Stdb.StdbGroup.make("NativeRanges")
  .add(
    Stdb.StdbFn.reducer("nativeRangeClear", {
      params: Stdb.struct({}),
    }),
  )
  .add(
    Stdb.StdbFn.reducer("nativeRangeInsert", {
      params: Stdb.struct({
        owner: Stdb.identity(),
        happenedAt: Stdb.timestamp(),
        label: String255,
      }),
    }),
  )
  .add(
    Stdb.StdbFn.procedure("nativeRangeByOwner", {
      params: Stdb.struct({
        lo: Stdb.identity(),
        hi: Stdb.identity(),
      }),
      returns: Stdb.array(String255),
    }),
  )
  .add(
    Stdb.StdbFn.procedure("nativeRangeByTimestamp", {
      params: Stdb.struct({
        lo: Stdb.timestamp(),
        hi: Stdb.timestamp(),
      }),
      returns: Stdb.array(String255),
    }),
  )
  .add(
    Stdb.StdbFn.reducer("optionalRangeClear", {
      params: Stdb.struct({}),
    }),
  )
  .add(
    Stdb.StdbFn.reducer("optionalRangeInsert", {
      params: Stdb.struct({
        rank: Stdb.option(U64),
        label: String255,
      }),
    }),
  )
  .add(
    Stdb.StdbFn.procedure("optionalRangeAfterUnset", {
      params: Stdb.struct({}),
      returns: Stdb.array(String255),
    }),
  )
