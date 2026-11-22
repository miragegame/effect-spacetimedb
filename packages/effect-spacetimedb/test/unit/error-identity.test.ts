import * as EffectVitest from "@effect/vitest"
import * as Cause from "effect/Cause"
import * as Option from "effect/Option"
import {
  StdbDecodeError,
  SubscriptionInvalidatedError,
  SubscriptionRejectedError,
  SubscriptionTransportError,
  TransportError,
} from "effect-spacetimedb/client"
import {
  HandlerAsyncNotAllowedDefect,
  StdbHostCallError,
  StdbSenderError,
  StdbUniqueAlreadyExistsError,
} from "effect-spacetimedb/server"
import {
  DomainCallError,
  RemoteRejectedBodyError,
  RemoteRejectedError,
  WsRpcInvokeError,
} from "../../src/client/call-errors"
import { errorTypeId } from "../../src/error-identity"

const { describe, expect, it } = EffectVitest

describe("nominal error identity", () => {
  it("recognizes owned errors by TypeId brand", () => {
    expect(
      StdbDecodeError.is(
        new StdbDecodeError({ phase: "row", cause: new Error("bad row") }),
      ),
    ).toBe(true)
    expect(
      RemoteRejectedError.is(new RemoteRejectedError({ raw: "err" })),
    ).toBe(true)
    expect(
      RemoteRejectedBodyError.is(
        new RemoteRejectedBodyError({ raw: "err", status: 500 }),
      ),
    ).toBe(true)
    expect(TransportError.is(new TransportError({ cause: "closed" }))).toBe(
      true,
    )
    expect(WsRpcInvokeError.is(new WsRpcInvokeError({ cause: "boom" }))).toBe(
      true,
    )
    expect(
      DomainCallError.is(
        new DomainCallError({
          error: { _tag: "Declared" as const },
        }),
      ),
    ).toBe(true)
    expect(
      SubscriptionRejectedError.is(
        new SubscriptionRejectedError({ raw: "rejected" }),
      ),
    ).toBe(true)
    expect(
      SubscriptionInvalidatedError.is(
        new SubscriptionInvalidatedError({
          raw: "invalidated",
          kind: "lost",
        }),
      ),
    ).toBe(true)
    expect(
      SubscriptionTransportError.is(
        new SubscriptionTransportError({ cause: "network" }),
      ),
    ).toBe(true)
    expect(
      StdbHostCallError.is(
        new StdbHostCallError({ op: "insert", cause: "host" }),
      ),
    ).toBe(true)
    expect(
      StdbUniqueAlreadyExistsError.is(
        new StdbUniqueAlreadyExistsError({ op: "insert", cause: "unique" }),
      ),
    ).toBe(true)
    expect(
      HandlerAsyncNotAllowedDefect.is(new HandlerAsyncNotAllowedDefect()),
    ).toBe(true)
    expect(StdbSenderError.is(new StdbSenderError({ value: "denied" }))).toBe(
      true,
    )
  })

  it("recognizes a reconstructed same-symbol object without instanceof", () => {
    const typeId = errorTypeId("StdbDecodeError")
    const reconstructed = {
      _tag: "StdbDecodeError",
      [typeId]: typeId,
      phase: "row",
      cause: "bad row",
    }

    expect(reconstructed instanceof StdbDecodeError).toBe(false)
    expect(StdbDecodeError.is(reconstructed)).toBe(true)
    expect(
      Cause.findErrorOption(Cause.fail(reconstructed)).pipe(
        Option.match({
          onNone: () => false,
          onSome: (error) => StdbDecodeError.is(error),
        }),
      ),
    ).toBe(true)
  })
})
