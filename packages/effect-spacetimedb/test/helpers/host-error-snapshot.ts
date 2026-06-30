export const HostErrorCodeSnapshot = {
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

export type HostErrorName = keyof typeof HostErrorCodeSnapshot

export const hostErrorNames = Object.keys(
  HostErrorCodeSnapshot,
) as ReadonlyArray<HostErrorName>
