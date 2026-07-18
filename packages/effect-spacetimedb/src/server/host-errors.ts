export const SpacetimeHostErrorCodes = {
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
} as const

export type SpacetimeHostErrorName = keyof typeof SpacetimeHostErrorCodes
export type SpacetimeHostErrorCode =
  (typeof SpacetimeHostErrorCodes)[SpacetimeHostErrorName]
const isNamedHostError = (value: unknown, name?: SpacetimeHostErrorName) =>
  typeof value === "object" &&
  value !== null &&
  "name" in value &&
  typeof value.name === "string" &&
  Object.hasOwn(SpacetimeHostErrorCodes, value.name) &&
  (name === undefined || value.name === name)

const isBaseHostError = (value: unknown) =>
  typeof value === "object" &&
  value !== null &&
  "name" in value &&
  value.name === "SpacetimeHostError"

export class SpacetimeHostError extends Error {
  static override [Symbol.hasInstance](value: unknown): boolean {
    return isBaseHostError(value) || isNamedHostError(value)
  }

  override get name(): string {
    return "SpacetimeHostError"
  }
}

export type SpacetimeHostErrorConstructor = {
  new (message: string): SpacetimeHostError
  readonly [Symbol.hasInstance]: (value: unknown) => boolean
}

const hostErrorClass = (
  hostErrorName: SpacetimeHostErrorName,
): SpacetimeHostErrorConstructor =>
  class extends SpacetimeHostError {
    static override [Symbol.hasInstance](value: unknown): boolean {
      return isNamedHostError(value, hostErrorName)
    }

    override get name(): string {
      return hostErrorName
    }
  }

export const SpacetimeHostErrors = {
  HostCallFailure: hostErrorClass("HostCallFailure"),
  NotInTransaction: hostErrorClass("NotInTransaction"),
  BsatnDecodeError: hostErrorClass("BsatnDecodeError"),
  NoSuchTable: hostErrorClass("NoSuchTable"),
  NoSuchIndex: hostErrorClass("NoSuchIndex"),
  NoSuchIter: hostErrorClass("NoSuchIter"),
  NoSuchConsoleTimer: hostErrorClass("NoSuchConsoleTimer"),
  NoSuchBytes: hostErrorClass("NoSuchBytes"),
  NoSpace: hostErrorClass("NoSpace"),
  BufferTooSmall: hostErrorClass("BufferTooSmall"),
  UniqueAlreadyExists: hostErrorClass("UniqueAlreadyExists"),
  ScheduleAtDelayTooLong: hostErrorClass("ScheduleAtDelayTooLong"),
  IndexNotUnique: hostErrorClass("IndexNotUnique"),
  NoSuchRow: hostErrorClass("NoSuchRow"),
  AutoIncOverflow: hostErrorClass("AutoIncOverflow"),
  WouldBlockTransaction: hostErrorClass("WouldBlockTransaction"),
  TransactionNotAnonymous: hostErrorClass("TransactionNotAnonymous"),
  TransactionIsReadOnly: hostErrorClass("TransactionIsReadOnly"),
  TransactionIsMut: hostErrorClass("TransactionIsMut"),
  HttpError: hostErrorClass("HttpError"),
} as const satisfies Record<
  SpacetimeHostErrorName,
  SpacetimeHostErrorConstructor
>

export const SpacetimeHostErrorsByCode = {
  1: SpacetimeHostErrors.HostCallFailure,
  2: SpacetimeHostErrors.NotInTransaction,
  3: SpacetimeHostErrors.BsatnDecodeError,
  4: SpacetimeHostErrors.NoSuchTable,
  5: SpacetimeHostErrors.NoSuchIndex,
  6: SpacetimeHostErrors.NoSuchIter,
  7: SpacetimeHostErrors.NoSuchConsoleTimer,
  8: SpacetimeHostErrors.NoSuchBytes,
  9: SpacetimeHostErrors.NoSpace,
  11: SpacetimeHostErrors.BufferTooSmall,
  12: SpacetimeHostErrors.UniqueAlreadyExists,
  13: SpacetimeHostErrors.ScheduleAtDelayTooLong,
  14: SpacetimeHostErrors.IndexNotUnique,
  15: SpacetimeHostErrors.NoSuchRow,
  16: SpacetimeHostErrors.AutoIncOverflow,
  17: SpacetimeHostErrors.WouldBlockTransaction,
  18: SpacetimeHostErrors.TransactionNotAnonymous,
  19: SpacetimeHostErrors.TransactionIsReadOnly,
  20: SpacetimeHostErrors.TransactionIsMut,
  21: SpacetimeHostErrors.HttpError,
} as const satisfies Record<
  SpacetimeHostErrorCode,
  SpacetimeHostErrorConstructor
>
