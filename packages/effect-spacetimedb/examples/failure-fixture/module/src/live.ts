import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Stdb from "effect-spacetimedb"
import { FailureErrors, FailureModule } from "./contract"

const { Db, MutationCtx, withTx } = FailureModule

/** Text a caller must never see and the module log must. */
export const defectDetail = "/srv/module/secret-detail"

class FixtureDefect extends Data.TaggedError("FixtureDefect")<{
  readonly path: string
}> {}

let count = 0n

export const FailureFunctionsLive = Stdb.Builder.group(
  FailureModule,
  "Failures",
  {
    nextCount: () =>
      Effect.suspend(() => {
        count = count + 1n
        return Effect.succeed(count)
      }),
    echoShort: ({ value }) => Effect.succeed(value),
    dieWithDetail: () => Effect.die(new FixtureDefect({ path: defectDetail })),
    failDeclared: () =>
      Effect.fail(FailureErrors.Refused.make({ reason: "declared" })),
    insertThenDie: Effect.fn(function* ({ id }) {
      return yield* withTx(
        Effect.gen(function* () {
          const db = yield* Db
          yield* db.attempt.insert({ id, writer: "transaction" })
          return yield* Effect.die(new FixtureDefect({ path: defectDetail }))
        }),
      )
    }),
    insertInRelease: Effect.fn(function* ({ id }) {
      yield* withTx(
        Effect.gen(function* () {
          const db = yield* Db
          yield* Effect.acquireRelease(Effect.void, () =>
            Effect.orDie(db.attempt.insert({ id, writer: "transaction" })),
          )
        }),
      )
    }),
    insertThenReleaseDies: Effect.fn(function* ({ id }) {
      yield* withTx(
        Effect.gen(function* () {
          const db = yield* Db
          yield* db.attempt.insert({ id, writer: "transaction" })
          yield* Effect.acquireRelease(Effect.void, () =>
            Effect.die(new FixtureDefect({ path: defectDetail })),
          )
        }),
      )
    }),
    recordShort: Effect.fn(function* ({ value }) {
      const db = yield* Db
      yield* db.attempt.insert({ id: value, writer: "reducer" })
    }),
    scheduleFailingRun: Effect.fn(function* ({ note }) {
      const db = yield* Db
      const ctx = yield* MutationCtx
      yield* db.failingRun.schedule({
        scheduledAt: Stdb.ScheduleAt.after(ctx.timestamp, "1 millis"),
        note,
      })
    }),
    failRun: () => Effect.die(new FixtureDefect({ path: defectDetail })),
    failingView: () => Effect.die(new FixtureDefect({ path: defectDetail })),
  },
)
