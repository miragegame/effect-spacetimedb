import * as Effect from "effect/Effect"
import * as Stdb from "effect-spacetimedb"
import { StdbValidationDefect } from "../../../src/contract/module-validation.ts"
import { makeServer } from "../../helpers/module-server"
import { compileModule } from "../../helpers/compile-module"
import { TestSyncRunner } from "../../helpers/sync-runner"

const moduleHooksKey = Symbol.for("spacetime:sys/moduleHooks")

type NativeScheduleDef = {
  readonly sourceName: string | undefined
  readonly tableName: string
  readonly scheduleAtCol: number
  readonly functionName: string
}

type NativeModuleDef = {
  readonly reducers: ReadonlyArray<{ readonly sourceName: string }>
  readonly procedures: ReadonlyArray<{ readonly sourceName: string }>
  readonly schedules: ReadonlyArray<NativeScheduleDef>
}

type NativeSchema = {
  readonly moduleDef: NativeModuleDef
} & Record<symbol, (exports: object) => unknown>

export type ScheduleRegistrationProbe = {
  readonly reducerNames: ReadonlyArray<string>
  readonly procedureNames: ReadonlyArray<string>
  readonly schedules: ReadonlyArray<NativeScheduleDef>
  readonly scheduleAtColumnIndexes: Readonly<Record<string, number>>
  readonly duplicateScheduleFailure: {
    readonly tag: string
    readonly diagnosticCodes: ReadonlyArray<string>
  }
}

const sweepSchedule = Stdb.scheduledTable("sweepSchedule", {
  columns: { poolId: Stdb.string() },
})

const digestSchedule = Stdb.scheduledTable("digestSchedule", {
  columns: { note: Stdb.string() },
})

const ScheduledModule = Stdb.Module.make("schedule_registration", {})
  .addTables(sweepSchedule, digestSchedule)
  .add(
    Stdb.Group.make("Jobs")
      .add(Stdb.Fn.scheduledReducer("sweepPools", { table: sweepSchedule }))
      .add(Stdb.Fn.scheduledProcedure("sendDigest", { table: digestSchedule })),
  ).spec

/**
 * Two scheduled targets on one table. The module spec is built lazily because
 * declaring it is itself the failure this fixture reports.
 */
const buildDuplicateScheduleModule = (): unknown => {
  const sharedSchedule = Stdb.scheduledTable("sharedSchedule", {
    columns: { note: Stdb.string() },
  })

  return Stdb.Module.make("duplicate_schedule", {})
    .addTables(sharedSchedule)
    .add(
      Stdb.Group.make("Jobs")
        .add(
          Stdb.Fn.scheduledReducer("firstTarget", {
            table: sharedSchedule,
          }),
        )
        .add(
          Stdb.Fn.scheduledProcedure("secondTarget", {
            table: sharedSchedule,
          }),
        ),
    ).spec
}

const scheduleAtColumnIndex = (table: {
  readonly columns: Readonly<Record<string, unknown>>
}): number => Object.keys(table.columns).indexOf("scheduledAt")

const failureOf = (
  run: () => void,
): ScheduleRegistrationProbe["duplicateScheduleFailure"] => {
  // This fixture reports how the non-Effect compiler entrypoint fails, so the
  // thrown value is the observation; there is no Effect channel to read here.
  try {
    run()
  } catch (cause) {
    return cause instanceof StdbValidationDefect
      ? {
          tag: cause._tag,
          diagnosticCodes: cause.diagnostics.map(
            (diagnostic) => diagnostic.code,
          ),
        }
      : {
          tag: `${(cause as Error).name}: ${(cause as Error).message}`,
          diagnosticCodes: [],
        }
  }
  return { tag: "no failure", diagnosticCodes: [] }
}

export const probe = (): ScheduleRegistrationProbe => {
  const server = makeServer({
    module: ScheduledModule,
    runtime: TestSyncRunner,
  })
  const compiled = compileModule({
    server,
    handlers: server.handlers({
      reducers: { sweepPools: Effect.fn(function* (_args) {}) },
      procedures: { sendDigest: Effect.fn(function* (_args) {}) },
    }),
  })

  const schema = compiled.schema as NativeSchema
  // Run the SDK's module-registration hook exactly as the host does; it is what
  // turns the compiler's `onSchedule` options into schedule definitions.
  schema[moduleHooksKey]?.call(schema, {
    default: schema,
    ModuleExports: compiled.exportGroup(),
  })
  const moduleDef = schema.moduleDef

  return {
    reducerNames: moduleDef.reducers.map((reducer) => reducer.sourceName),
    procedureNames: moduleDef.procedures.map(
      (procedure) => procedure.sourceName,
    ),
    schedules: moduleDef.schedules.map((schedule) => ({ ...schedule })),
    scheduleAtColumnIndexes: {
      sweepSchedule: scheduleAtColumnIndex(sweepSchedule),
      digestSchedule: scheduleAtColumnIndex(digestSchedule),
    },
    duplicateScheduleFailure: failureOf(() => {
      void buildDuplicateScheduleModule()
    }),
  }
}
