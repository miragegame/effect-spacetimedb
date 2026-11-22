import * as Stdb from "effect-spacetimedb"
import { U64 } from "../schema"

export const NativeRangeFunctions = Stdb.Group.make("NativeRanges")
  .add(
    Stdb.Fn.reducer("nativeRangeClear", {
      params: Stdb.struct({}),
    }),
  )
  .add(
    Stdb.Fn.reducer("nativeRangeInsert", {
      params: Stdb.struct({
        owner: Stdb.identity(),
        happenedAt: Stdb.timestamp(),
        label: Stdb.string(),
      }),
    }),
  )
  .add(
    Stdb.Fn.procedure("nativeRangeByOwner", {
      params: Stdb.struct({
        lo: Stdb.identity(),
        hi: Stdb.identity(),
      }),
      returns: Stdb.array(Stdb.string()),
    }),
  )
  .add(
    Stdb.Fn.procedure("nativeRangeByTimestamp", {
      params: Stdb.struct({
        lo: Stdb.timestamp(),
        hi: Stdb.timestamp(),
      }),
      returns: Stdb.array(Stdb.string()),
    }),
  )
  .add(
    Stdb.Fn.reducer("optionalRangeClear", {
      params: Stdb.struct({}),
    }),
  )
  .add(
    Stdb.Fn.reducer("optionalRangeInsert", {
      params: Stdb.struct({
        rank: Stdb.option(U64),
        label: Stdb.string(),
      }),
    }),
  )
  .add(
    Stdb.Fn.procedure("optionalRangeAfterUnset", {
      params: Stdb.struct({}),
      returns: Stdb.array(Stdb.string()),
    }),
  )
