import * as Schema from "effect/Schema"
import * as Stdb from "effect-spacetimedb"

// A module that fails in every way a host call can. `nextCount` reads a
// module-level counter, so the live suite can tell whether a failure cost the
// module its isolate: a rebuilt isolate starts counting again.

export const FailureErrors = Stdb.errors.namespace("FailureFixture")({
  Refused: Stdb.error({ reason: Stdb.string() }),
})

/** The host accepts any string here; only the module's own decode refuses. */
const ShortText = Stdb.string(Schema.String.check(Schema.isMaxLength(4)))

// `writer` differs per function because the host's tables are sets: inserting a
// row identical to a stored one is a no-op, and only a different row with the
// same key collides. The suite reads a surviving row from that collision.
export const attempt = Stdb.table("attempt", {
  public: true,
  columns: {
    id: Stdb.string().primaryKey(),
    writer: Stdb.string(),
  },
})

export const failingRun = Stdb.scheduledTable("failingRun", {
  columns: {
    note: Stdb.string(),
  },
})

export const FailureFunctions = Stdb.Group.make("Failures")
  .add(Stdb.Fn.procedure("nextCount", { returns: Stdb.u64() }))
  .add(
    Stdb.Fn.procedure("echoShort", {
      params: Stdb.struct({ value: ShortText }),
      returns: Stdb.string(),
    }),
  )
  .add(Stdb.Fn.procedure("dieWithDetail", { returns: Stdb.unit() }))
  .add(
    Stdb.Fn.procedure("failDeclared", {
      returns: Stdb.unit(),
      errors: FailureErrors,
    }),
  )
  .add(
    Stdb.Fn.procedure("insertThenDie", {
      params: Stdb.struct({ id: Stdb.string() }),
      returns: Stdb.unit(),
    }),
  )
  .add(
    Stdb.Fn.procedure("insertInRelease", {
      params: Stdb.struct({ id: Stdb.string() }),
      returns: Stdb.unit(),
    }),
  )
  .add(
    Stdb.Fn.procedure("insertThenReleaseDies", {
      params: Stdb.struct({ id: Stdb.string() }),
      returns: Stdb.unit(),
    }),
  )
  .add(
    Stdb.Fn.reducer("recordShort", {
      params: Stdb.struct({ value: ShortText }),
    }),
  )
  .add(
    Stdb.Fn.reducer("scheduleFailingRun", {
      params: Stdb.struct({ note: Stdb.string() }),
    }),
  )
  .add(Stdb.Fn.scheduledProcedure("failRun", { table: failingRun }))
  .add(
    Stdb.Fn.anonymousView("failingView", {
      returns: Stdb.array(attempt.row),
    }),
  )

export const FailureModule = Stdb.Module.make("effect_spacetimedb_failures", {})
  .addTables(attempt, failingRun)
  .add(FailureFunctions)
