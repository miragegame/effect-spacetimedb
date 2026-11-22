import * as EffectVitest from "@effect/vitest"
import type * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { Identity, Timestamp } from "spacetimedb"
import * as Stdb from "effect-spacetimedb"
import { StdbDecodeError } from "effect-spacetimedb/server"
import * as StdbTesting from "effect-spacetimedb/testing"
import { compileModule } from "../helpers/compile-module"
import { makeServer } from "../helpers/module-server"
import { makeRecordingRunner } from "../helpers/server-runtime"
import { invokeModuleExport, SenderError } from "../helpers/spacetimedb-server"

const { describe, expect, it } = EffectVitest

// The host accepts any string here; only the module's own decode refuses.
const ShortText = Stdb.string(Schema.String.check(Schema.isMaxLength(4)))
// Fails in the module's own code, whatever the caller sent.
const BrokenText = Stdb.string(
  Schema.String.check(
    Schema.makeFilter(() => {
      throw new Error("the schema broke")
    }),
  ),
)

const entry = Stdb.table("entry", {
  public: true,
  columns: {
    id: Stdb.string().primaryKey(),
  },
})
const closedJob = Stdb.scheduledTable("closedJob", {
  columns: { note: ShortText },
})
const openJob = Stdb.scheduledTable("openJob", {
  columns: { note: ShortText },
})
const closedReducerJob = Stdb.scheduledTable("closedReducerJob", {
  columns: { note: ShortText },
})
const openReducerJob = Stdb.scheduledTable("openReducerJob", {
  columns: { note: ShortText },
})

const ReportsModule = Stdb.Module.make("compiled_failure_reports", {})
  .addTables(entry, closedJob, openJob, closedReducerJob, openReducerJob)
  .add(
    Stdb.Group.make("Reports")
      .add(Stdb.Fn.scheduledProcedure("closedFire", { table: closedJob }))
      .add(
        Stdb.Fn.scheduledProcedure("openFire", {
          table: openJob,
          allowExternalCallers: true,
        }),
      )
      .add(
        Stdb.Fn.scheduledReducer("closedFireReducer", {
          table: closedReducerJob,
        }),
      )
      .add(
        Stdb.Fn.scheduledReducer("openFireReducer", {
          table: openReducerJob,
          allowExternalCallers: true,
        }),
      )
      .add(
        Stdb.Fn.anonymousView("entries", {
          returns: Stdb.array(entry.row),
        }),
      )
      .add(
        Stdb.Fn.view("mine", {
          returns: Stdb.array(entry.row),
        }),
      )
      .add(
        Stdb.Fn.anonymousView("byPrefix", {
          params: Stdb.struct({ prefix: ShortText }),
          returns: Stdb.array(entry.row),
        }),
      )
      .add(
        Stdb.Fn.anonymousView("byBroken", {
          params: Stdb.struct({ prefix: BrokenText }),
          returns: Stdb.array(entry.row),
        }),
      ),
  ).spec

const scheduler = new Identity(1n)
const client = new Identity(2n)

const compileReports = (
  handlers: {
    readonly entries?: () => Effect.Effect<ReadonlyArray<unknown>>
    readonly mine?: () => Effect.Effect<ReadonlyArray<unknown>>
  } = {},
) => {
  const observed: Array<Cause.Cause<unknown>> = []
  const logged: Array<string> = []
  let fired = 0
  const fire = () =>
    Effect.suspend(() => {
      fired = fired + 1
      return Effect.void
    })
  const server = makeServer({
    module: ReportsModule,
    onDefect: (cause) => {
      observed.push(cause)
    },
    runtime: makeRecordingRunner(logged),
  })
  const compiled = compileModule({
    server,
    handlers: server.handlers({
      procedures: { closedFire: fire, openFire: fire },
      reducers: { closedFireReducer: fire, openFireReducer: fire },
      views: {
        entries: (handlers.entries ?? (() => Effect.succeed([]))) as never,
        mine: (handlers.mine ?? (() => Effect.succeed([]))) as never,
        byPrefix: () => Effect.succeed([]),
        byBroken: () => Effect.succeed([]),
      },
    }),
  })
  return { compiled, fired: () => fired, logged, observed }
}

const makeProcedureCtx = (sender: Identity) =>
  StdbTesting.makeTestModuleHarness(ReportsModule).makeProcedureCtx({
    sender,
    databaseIdentity: scheduler,
  })

const makeReducerCtx = (sender: Identity) =>
  StdbTesting.makeTestModuleHarness(ReportsModule, {
    databaseIdentity: scheduler,
  }).makeMutationCtx({ sender })

const scheduledArgs = (note: string) => ({
  data: {
    scheduledId: 0n,
    scheduledAt: Stdb.ScheduleAt.after(new Timestamp(0n), "1 second"),
    note,
  },
})

const makeViewCtx = () => {
  const harness = StdbTesting.makeTestModuleHarness(ReportsModule)
  return { db: harness.db, from: {} }
}

const thrownBy = (run: () => unknown): unknown => {
  try {
    run()
    return undefined
  } catch (thrown) {
    return thrown
  }
}

describe("compiled scheduled procedures", () => {
  it("runs a row that decodes", () => {
    const { compiled, fired, logged, observed } = compileReports()

    invokeModuleExport(
      compiled.exports.closed_fire,
      makeProcedureCtx(scheduler),
      scheduledArgs("ok"),
    )

    expect(fired()).toBe(1)
    expect(observed.length).toBe(0)
    expect(logged.length).toBe(0)
  })

  it("reports a row that no longer decodes, once, and returns unit", () => {
    const { compiled, fired, logged, observed } = compileReports()

    const reply = invokeModuleExport(
      compiled.exports.closed_fire,
      makeProcedureCtx(scheduler),
      scheduledArgs("longer than four"),
    )

    expect(reply).toBeUndefined()
    expect(fired()).toBe(0)
    expect(observed.length).toBe(1)
    expect(logged.length).toBe(1)
    expect(logged[0]).toContain("closedFire")
  })

  it("turns a client away with unit and not a line of log", () => {
    const { compiled, fired, logged, observed } = compileReports()

    const reply = invokeModuleExport(
      compiled.exports.closed_fire,
      makeProcedureCtx(client),
      scheduledArgs("ok"),
    )

    expect(reply).toBeUndefined()
    expect(fired()).toBe(0)
    expect(observed.length).toBe(0)
    expect(logged.length).toBe(0)
  })

  it("leaves a client's bad row to an open target out of the log", () => {
    const { compiled, fired, logged, observed } = compileReports()

    const reply = invokeModuleExport(
      compiled.exports.open_fire,
      makeProcedureCtx(client),
      scheduledArgs("longer than four"),
    )

    expect(reply).toBeUndefined()
    expect(fired()).toBe(0)
    expect(observed.length).toBe(0)
    expect(logged.length).toBe(0)
  })

  it("still reports the scheduler's own bad row to an open target", () => {
    const { compiled, logged, observed } = compileReports()

    invokeModuleExport(
      compiled.exports.open_fire,
      makeProcedureCtx(scheduler),
      scheduledArgs("longer than four"),
    )

    expect(observed.length).toBe(1)
    expect(logged.length).toBe(1)
  })
})

describe("compiled scheduled reducers", () => {
  it("runs a row that decodes", () => {
    const { compiled, fired, logged, observed } = compileReports()

    invokeModuleExport(
      compiled.exports.closed_fire_reducer,
      makeReducerCtx(scheduler),
      scheduledArgs("ok"),
    )

    expect(fired()).toBe(1)
    expect(observed.length).toBe(0)
    expect(logged.length).toBe(0)
  })

  it("reports a row that no longer decodes, once, and still throws", () => {
    const { compiled, fired, logged, observed } = compileReports()

    expect(
      thrownBy(() =>
        invokeModuleExport(
          compiled.exports.closed_fire_reducer,
          makeReducerCtx(scheduler),
          scheduledArgs("longer than four"),
        ),
      ),
    ).toBeInstanceOf(StdbDecodeError)

    expect(fired()).toBe(0)
    expect(observed.length).toBe(1)
    expect(logged.length).toBe(1)
    expect(logged[0]).toContain("closedFireReducer")
  })

  it("turns a client away with a sender error and not a line of log", () => {
    const { compiled, fired, logged, observed } = compileReports()

    expect(
      thrownBy(() =>
        invokeModuleExport(
          compiled.exports.closed_fire_reducer,
          makeReducerCtx(client),
          scheduledArgs("ok"),
        ),
      ),
    ).toBeInstanceOf(SenderError)

    expect(fired()).toBe(0)
    expect(observed.length).toBe(0)
    expect(logged.length).toBe(0)
  })

  it("answers a client's bad row to an open target as bad arguments", () => {
    const { compiled, fired, logged, observed } = compileReports()

    const refusal = thrownBy(() =>
      invokeModuleExport(
        compiled.exports.open_fire_reducer,
        makeReducerCtx(client),
        scheduledArgs("longer than four"),
      ),
    )

    expect(refusal).toBeInstanceOf(SenderError)
    expect(refusal).toMatchObject({
      message: expect.stringContaining("Invalid arguments for openFireReducer"),
    })
    expect(fired()).toBe(0)
    expect(observed.length).toBe(0)
    expect(logged.length).toBe(0)
  })

  it("still reports the scheduler's own bad row to an open target", () => {
    const { compiled, logged, observed } = compileReports()

    expect(
      thrownBy(() =>
        invokeModuleExport(
          compiled.exports.open_fire_reducer,
          makeReducerCtx(scheduler),
          scheduledArgs("longer than four"),
        ),
      ),
    ).toBeInstanceOf(StdbDecodeError)

    expect(observed.length).toBe(1)
    expect(logged.length).toBe(1)
  })
})

describe("compiled views", () => {
  it("reports a result that does not encode, once, and still throws", () => {
    const { compiled, logged, observed } = compileReports({
      entries: () => Effect.succeed([{ id: 1 }]),
    })

    expect(
      thrownBy(() =>
        invokeModuleExport(compiled.exports.entries, makeViewCtx(), {}),
      ),
    ).toBeInstanceOf(StdbDecodeError)

    expect(observed.length).toBe(1)
    expect(logged.length).toBe(1)
    expect(logged[0]).toContain("entries")
  })

  it("names the sender of a sender view's failure", () => {
    const { compiled, logged, observed } = compileReports({
      mine: () => Effect.succeed([{ id: 1 }]),
    })

    expect(
      thrownBy(() =>
        invokeModuleExport(
          compiled.exports.mine,
          { ...makeViewCtx(), sender: client },
          {},
        ),
      ),
    ).toBeInstanceOf(StdbDecodeError)

    expect(observed.length).toBe(1)
    expect(logged.length).toBe(1)
  })

  it("still throws on a caller's bad arguments, and reports nothing", () => {
    const { compiled, logged, observed } = compileReports()

    expect(
      thrownBy(() =>
        invokeModuleExport(compiled.exports.by_prefix, makeViewCtx(), {
          prefix: "longer than four",
        }),
      ),
    ).toBeInstanceOf(StdbDecodeError)

    expect(observed.length).toBe(0)
    expect(logged.length).toBe(0)
  })

  it("reports arguments the module's own schema could not read", () => {
    const { compiled, logged, observed } = compileReports()

    expect(
      thrownBy(() =>
        invokeModuleExport(compiled.exports.by_broken, makeViewCtx(), {
          prefix: "ok",
        }),
      ),
    ).toBeInstanceOf(StdbDecodeError)

    expect(observed.length).toBe(1)
    expect(logged.length).toBe(1)
  })

  it("reports a failure of the view itself once, not twice", () => {
    const { compiled, logged, observed } = compileReports({
      entries: () => Effect.die("the view broke"),
    })

    expect(
      thrownBy(() =>
        invokeModuleExport(compiled.exports.entries, makeViewCtx(), {}),
      ),
    ).toBeDefined()

    expect(observed.length).toBe(1)
    expect(logged.length).toBe(1)
  })
})
