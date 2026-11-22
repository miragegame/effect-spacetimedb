import * as EffectVitest from "@effect/vitest"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"

const { describe, expect, it } = EffectVitest

import * as StdbTesting from "effect-spacetimedb/testing"
import * as StdbInternal from "effect-spacetimedb/testing/internal"
import { FullModule, UserMissing, type UserId } from "../fixtures/full-module"
import { fixtureCallDurationMax } from "../helpers/transport-bounds"
import { makeMockHttpClientLayer } from "../helpers/mock-http-client"
import { encodeJson } from "../helpers/json"
import { makeServer } from "../helpers/module-server"

class SecretDefect extends Data.TaggedError("SecretDefect")<{
  readonly path: string
}> {
  override readonly message = `internal path: ${this.path}`
}

const harness = StdbTesting.makeTestModuleHarness(FullModule)
const userArgs = { userId: "user-1" as UserId as never }

const failureOf = (reply: unknown) =>
  StdbInternal.ContractError.peekUndeclaredFailure(
    (reply as { readonly err: string }).err,
  )

const bindUserGet = (handler: () => Effect.Effect<never, never, never>) =>
  makeServer({ module: FullModule }).procedures({
    userGet: handler as never,
  }).userGet!

describe("procedure failure replies", () => {
  it("answers a defect with the fixed err and none of its text", () => {
    const reply = bindUserGet(() =>
      Effect.die(new SecretDefect({ path: "/srv/secret" })),
    ).invoke(harness.makeProcedureCtx(), userArgs)

    expect(failureOf(reply)?.reason).toBe("Failed")
    expect(JSON.stringify(reply)).not.toContain("/srv/secret")
    expect(JSON.stringify(reply)).not.toContain("    at ")
  })

  it("answers an interruption with the fixed err", () => {
    const reply = bindUserGet(() => Effect.interrupt).invoke(
      harness.makeProcedureCtx(),
      userArgs,
    )

    expect(failureOf(reply)?.reason).toBe("Failed")
  })

  it("answers a handler that threw before it returned an Effect", () => {
    const reply = bindUserGet(() => {
      throw new SecretDefect({ path: "/srv/secret" })
    }).invoke(harness.makeProcedureCtx(), userArgs)

    expect(failureOf(reply)?.reason).toBe("Failed")
  })

  it("rolls a failed withTx back before it answers", () => {
    const server = makeServer({ module: FullModule })
    const local = StdbTesting.makeTestModuleHarness(FullModule)
    const procedures = server.procedures({
      userGet: Effect.fn(function* () {
        return yield* server.withTx(
          Effect.gen(function* () {
            const db = yield* server.Db
            yield* db.user.insert({
              id: "user-1" as never,
              name: "Ada" as never,
            })
            return yield* Effect.die(new SecretDefect({ path: "abort" }))
          }),
        )
      }) as never,
    })

    const reply = procedures.userGet!.invoke(local.makeProcedureCtx(), userArgs)

    expect(failureOf(reply)?.reason).toBe("Failed")
    expect(local.db.user.count()).toBe(0n)
  })

  it("keeps the declared arm for a declared error", () => {
    const reply = makeServer({ module: FullModule })
      .procedures({
        userGet: (() =>
          Effect.fail(
            UserMissing.make({ userId: "user-1" as UserId }),
          )) as never,
      })
      .userGet!.invoke(harness.makeProcedureCtx(), userArgs)

    expect(failureOf(reply)).toBeUndefined()
    expect(
      StdbInternal.ContractError.peekStringEnvelopeTag(
        (reply as { readonly err: string }).err,
      ),
    ).toBe("UserMissing")
  })

  it("reads an unknown carrier version as an opaque rejection", () => {
    expect(
      StdbInternal.ContractError.peekUndeclaredFailure(
        '{"_effectSpacetimeDb":"UndeclaredFailure","version":2,"reason":"Failed","message":"x"}',
      ),
    ).toBeUndefined()
  })
})

describe("typed client over an undeclared failure", () => {
  const Envelope = StdbInternal.procedureResponseType(
    FullModule.procedures.userGet,
  )
  const client = StdbInternal.ClientHttp.make({
    module: FullModule,
    uri: "http://stdb.test",
    databaseName: "full",
    callDurationMax: fixtureCallDurationMax,
  })
  const answering = (err: string) =>
    makeMockHttpClientLayer(() =>
      Effect.succeed({
        body: encodeJson(StdbInternal.encodeHostValue(Envelope, { err })),
      }),
    )

  it.effect("rejects a failed call as a 500", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        client.procedures.userGet({ userId: "user-1" as UserId }).pipe(
          Effect.provide(
            answering(
              StdbInternal.ContractError.encodeUndeclaredFailure({
                reason: "Failed",
                message: "fixed",
              }),
            ),
          ),
        ),
      )

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const failure = exit.cause.reasons[0]
        expect(failure).toMatchObject({
          error: { _tag: "RemoteRejectedError", raw: "fixed", status: 500 },
        })
      }
    }),
  )

  it.effect("rejects bad arguments as a 400 that keeps the message", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        client.procedures.userGet({ userId: "user-1" as UserId }).pipe(
          Effect.provide(
            answering(
              StdbInternal.ContractError.encodeUndeclaredFailure({
                reason: "BadArguments",
                message: "userId is too long",
              }),
            ),
          ),
        ),
      )

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const failure = exit.cause.reasons[0]
        expect(failure).toMatchObject({
          error: {
            _tag: "RemoteRejectedError",
            raw: "userId is too long",
            status: 400,
          },
        })
      }
    }),
  )
})
