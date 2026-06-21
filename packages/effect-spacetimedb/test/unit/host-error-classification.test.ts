import * as EffectVitest from "@effect/vitest"
import {
  StdbAutoIncOverflowError,
  StdbHostCallError,
  StdbNoSuchRowError,
  StdbScheduleDelayTooLongError,
  StdbUniqueAlreadyExistsError,
  toHostFailure,
} from "../../src/server/services"
import {
  HostErrorCodeSnapshot,
  type HostErrorName,
  hostErrorNames,
} from "../helpers/host-error-snapshot"
import { hostCause } from "../helpers/server-runtime"

const { describe, expect, it } = EffectVitest

const typedHostErrorClasses = {
  AutoIncOverflow: StdbAutoIncOverflowError,
  NoSuchRow: StdbNoSuchRowError,
  ScheduleAtDelayTooLong: StdbScheduleDelayTooLongError,
  UniqueAlreadyExists: StdbUniqueAlreadyExistsError,
} as const satisfies Partial<
  Record<HostErrorName, new (...args: never) => Error>
>

describe("host error classification", () => {
  it("pins the known SpaceTimeDB host error name and code snapshot", () => {
    expect(HostErrorCodeSnapshot).toEqual({
      HostCallFailure: 1,
      NotInTransaction: 2,
      BsatnDecodeError: 3,
      NoSuchTable: 4,
      NoSuchIndex: 5,
      NoSuchIter: 6,
      NoSuchConsoleTimer: 7,
      NoSuchBytes: 8,
      NoSpace: 9,
      BufferTooSmall: 11,
      UniqueAlreadyExists: 12,
      ScheduleAtDelayTooLong: 13,
      IndexNotUnique: 14,
      NoSuchRow: 15,
      AutoIncOverflow: 16,
      WouldBlockTransaction: 17,
      TransactionNotAnonymous: 18,
      TransactionIsReadOnly: 19,
      TransactionIsMut: 20,
      HttpError: 21,
    })
  })

  it("maps every known host error name without losing identity", () => {
    for (const name of hostErrorNames) {
      const cause = hostCause(name)
      const failure = toHostFailure("db.test", cause)
      if (Object.hasOwn(typedHostErrorClasses, name)) {
        const typedClass =
          typedHostErrorClasses[name as keyof typeof typedHostErrorClasses]
        expect(failure).toBeInstanceOf(typedClass)
        expect(failure).toMatchObject({
          cause,
          op: "db.test",
        })
      } else {
        expect(failure).toBeInstanceOf(StdbHostCallError)
        expect(failure).toMatchObject({
          cause,
          hostErrorName: name,
          op: "db.test",
        })
      }
    }
  })
})
