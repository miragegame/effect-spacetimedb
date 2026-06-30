import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem"
import * as NodePath from "@effect/platform-node/NodePath"
import * as EffectVitest from "@effect/vitest"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"

const { expect } = EffectVitest

import * as StdbTesting from "effect-spacetimedb/testing"
import {
  CapturedTransportModule,
  ThingId,
  UserId,
  UserMissingError,
} from "../fixtures/captured-transport-module"
import { readCapturedJson } from "../helpers/captured-event-codec"
import { TestLayer } from "../helpers/test-layer"
import { makeStaticRelationHandle } from "../helpers/ws-fixtures"

const describe = EffectVitest.layer(
  Layer.mergeAll(TestLayer, NodeFileSystem.layer, NodePath.layer),
)

const transportFixture = (name: string): URL =>
  new URL(`../fixtures/captured/transport-values/${name}.json`, import.meta.url)

const readCapturedTransport = (name: string) =>
  readCapturedJson(transportFixture(name)).pipe(Effect.orDie)

const decodeThingId = Schema.decodeUnknownSync(ThingId)
const decodeUserId = Schema.decodeUnknownSync(UserId)

const unexpectedSubscriptionBuilder = (): StdbTesting.SubscriptionBuilderLike<
  unknown,
  StdbTesting.ClientQueryRoot<typeof CapturedTransportModule>
> => {
  const builder: StdbTesting.SubscriptionBuilderLike<
    unknown,
    StdbTesting.ClientQueryRoot<typeof CapturedTransportModule>
  > = {
    onApplied: () => builder,
    onError: () => builder,
    subscribe: () => {
      throw new Error("unexpected captured transport subscription")
    },
  }

  return builder
}

const makeExampleWsConnection = (): StdbTesting.WsConnectionLike<
  typeof CapturedTransportModule,
  unknown
> => ({
  db: {
    user: makeStaticRelationHandle(),
    thing: makeStaticRelationHandle(),
  },
  subscriptionBuilder: unexpectedSubscriptionBuilder,
})

const makeWsClient = (transport: StdbTesting.WsCallableTransport) =>
  StdbTesting.ClientWs.make({
    module: CapturedTransportModule,
    connection: makeExampleWsConnection(),
    transport,
  })

const noopReducer = () => Promise.resolve()
const noopProcedure = () => Promise.resolve(undefined)

const expectExitError = <A, E>(exit: Exit.Exit<A, E>): E | undefined =>
  Exit.isFailure(exit)
    ? exit.cause.pipe(Cause.findErrorOption, Option.getOrUndefined)
    : undefined

describe("captured transport replay", (it) => {
  it.effect("replays captured reducer transport values through WS calls", () =>
    Effect.gen(function* () {
      const reducerErr = yield* readCapturedTransport("reducer-err")
      const reducerInternalError = yield* readCapturedTransport(
        "reducer-internal-error",
      )
      const reducerOkEmpty = yield* readCapturedTransport("reducer-ok-empty")

      const declaredErrorClient = makeWsClient({
        callReducerWithParams: () => Promise.reject(reducerErr),
        callProcedureWithParams: noopProcedure,
      })
      const declaredErrorExit = yield* Effect.exit(
        declaredErrorClient.reducers.userRequire({
          userId: decodeUserId("capture-missing-user"),
        }),
      )
      const declaredError = expectExitError(declaredErrorExit)
      expect(declaredError).toBeInstanceOf(UserMissingError)
      expect(declaredError).toMatchObject({
        userId: decodeUserId("capture-missing-user"),
      })

      const internalErrorClient = makeWsClient({
        callReducerWithParams: () => Promise.reject(reducerInternalError),
        callProcedureWithParams: noopProcedure,
      })
      const internalErrorExit = yield* Effect.exit(
        internalErrorClient.reducers.thingPanic({}),
      )
      expect(expectExitError(internalErrorExit)).toMatchObject({
        _tag: "RemoteRejectedError",
      })

      const okEmptyClient = makeWsClient({
        callReducerWithParams: () => Promise.resolve(reducerOkEmpty as void),
        callProcedureWithParams: noopProcedure,
      })
      yield* okEmptyClient.reducers.thingNoop({})
    }),
  )

  it.effect(
    "replays captured procedure transport values through WS calls",
    () =>
      Effect.gen(function* () {
        const procedureOk = yield* readCapturedTransport("procedure-ok")
        const procedureErr = yield* readCapturedTransport("procedure-err")

        const okClient = makeWsClient({
          callReducerWithParams: noopReducer,
          callProcedureWithParams: () => Promise.resolve(procedureOk),
        })
        expect(
          yield* okClient.procedures.thingOutcome({
            thingId: decodeThingId("capture-subscribe-thing"),
          }),
        ).toEqual({
          ok: {
            id: decodeThingId("capture-subscribe-thing"),
            label: "Subscribe Fixture",
            count: 1n,
          },
        })

        const errClient = makeWsClient({
          callReducerWithParams: noopReducer,
          callProcedureWithParams: () => Promise.resolve(procedureErr),
        })
        expect(
          yield* errClient.procedures.thingOutcome({
            thingId: decodeThingId("capture-missing-thing"),
          }),
        ).toEqual({
          err: "thing missing",
        })
      }),
  )
})
