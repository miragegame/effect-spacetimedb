import * as Data from "effect/Data"
import * as Option from "effect/Option"
import * as Result from "effect/Result"
import type { Identity, Timestamp } from "spacetimedb"
import { structFieldWireType } from "../contract/type/constructors.ts"
import type { AnyValueType } from "../contract/type/core.ts"
import { sumVariantEntry } from "../contract/type/envelope.ts"
import { foldValue } from "../contract/type/value-fold.ts"
import { type IdentityHex, normalizeIdentity } from "../identity.ts"
import { isHostRecord } from "./host-abi-runtime.ts"
import type { ServerSenderAuth } from "./runtime-types.ts"

export { OutboxResult } from "../contract/outbox-result.ts"
export { OutboxRowTooLarge } from "../contract/outbox-table.ts"

/**
 * An outbox row addressed to the sending database itself. Peers come only from
 * the module's peer resolver, which never resolves the module's own identity,
 * so reaching this is a bug in that resolver.
 */
export class OutboxSelfTargetDefect extends Data.TaggedError(
  "OutboxSelfTargetDefect",
)<{
  readonly table: string
  readonly target: string
}> {}

/**
 * An outbox insert from a context that is not a reducer, a scheduled reducer, a
 * settle reducer or a procedure transaction: an HTTP handler transaction has no
 * sending transaction time to stamp, and views cannot write.
 */
export class OutboxSendOutsideMutationDefect extends Data.TaggedError(
  "OutboxSendOutsideMutationDefect",
)<{
  readonly table: string
}> {}

/** What an outbox insert needs from the transaction it runs in. */
export type OutboxSendContext = {
  readonly timestamp: Timestamp
  readonly databaseIdentity: unknown
}

const isHighSurrogate = (code: number): boolean =>
  code >= 0xd800 && code <= 0xdbff
const isLowSurrogate = (code: number): boolean =>
  code >= 0xdc00 && code <= 0xdfff

/**
 * The UTF-8 length of `value` as the host writes it. A high surrogate
 * followed by a low one is one four-byte code point; any other surrogate is
 * written as U+FFFD, three bytes, like every other unit from U+0800 up.
 */
const utf8ByteLength = (value: string): number => {
  let bytes = 0
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code < 0x80) {
      bytes += 1
    } else if (code < 0x800) {
      bytes += 2
    } else if (
      isHighSurrogate(code) &&
      index + 1 < value.length &&
      isLowSurrogate(value.charCodeAt(index + 1))
    ) {
      bytes += 4
      index += 1
    } else {
      bytes += 3
    }
  }
  return bytes
}

/** A host value our own row encoding produced that does not fit its type. */
class OutboxRowSizeDefect extends Data.TaggedError("OutboxRowSizeDefect")<{
  readonly expected:
    | "descriptor"
    | "array"
    | "struct"
    | "sum"
    | "result"
    | "custom item"
    | "string"
    | "bytes"
    | "primitive"
  readonly value: unknown
}> {}

const fixedPrimitiveBytes: Readonly<Record<string, number>> = {
  bool: 1,
  i8: 1,
  u8: 1,
  i16: 2,
  u16: 2,
  i32: 4,
  u32: 4,
  f32: 4,
  i64: 8,
  u64: 8,
  f64: 8,
  i128: 16,
  u128: 16,
  i256: 32,
  u256: 32,
  identity: 32,
  connectionId: 16,
  uuid: 16,
  timestamp: 8,
  timeDuration: 8,
  // A one-byte tag and an eight-byte time or duration.
  scheduleAt: 9,
  unit: 0,
}

const lengthPrefixBytes = 4

/**
 * The BSATN size of a host value of `type`, as the host serializes it: fixed
 * widths for scalars, a 4-byte length before strings, byte arrays and arrays,
 * a 1-byte tag before every sum, option and result. The host value is our own
 * encoding of a value the codec accepted, so a shape this does not recognise
 * is a defect.
 */
export const hostValueBsatnBytes: (
  type: AnyValueType,
  value: unknown,
) => number = foldValue<number>({
  absent: (_type, _value) => {
    throw new OutboxRowSizeDefect({ expected: "descriptor", value: _value })
  },
  array: (_type, item, value, recurse) => {
    if (!Array.isArray(value)) {
      throw new OutboxRowSizeDefect({ expected: "array", value })
    }
    let bytes = lengthPrefixBytes
    for (const entry of value) {
      bytes += recurse(item, entry)
    }
    return bytes
  },
  option: (_type, item, value, recurse) =>
    1 + (value === undefined ? 0 : recurse(item, value)),
  struct: (_type, fields, value, recurse) => {
    if (!isHostRecord(value)) {
      throw new OutboxRowSizeDefect({ expected: "struct", value })
    }
    let bytes = 0
    for (const [key, field] of Object.entries(fields)) {
      bytes += recurse(structFieldWireType(field), value[key])
    }
    return bytes
  },
  sum: (_type, variants, value, recurse) => {
    if (!isHostRecord(value) || typeof value.tag !== "string") {
      throw new OutboxRowSizeDefect({ expected: "sum", value })
    }
    // Receiver-parameter columns carry the binding's PascalCase variant
    // names; our own columns carry the authored ones.
    const entry = sumVariantEntry(variants, value.tag)
    if (entry === undefined) {
      throw new OutboxRowSizeDefect({ expected: "sum", value })
    }
    return 1 + recurse(entry[1], value.value)
  },
  result: (_type, members, value, recurse) => {
    if (!isHostRecord(value)) {
      throw new OutboxRowSizeDefect({ expected: "result", value })
    }
    const [ok, err] = members
    if (ok !== undefined && Object.hasOwn(value, "ok")) {
      return 1 + recurse(ok, value.ok)
    }
    if (err !== undefined && Object.hasOwn(value, "err")) {
      return 1 + recurse(err, value.err)
    }
    throw new OutboxRowSizeDefect({ expected: "result", value })
  },
  custom: (_type, item, value, recurse) => {
    if (item === undefined) {
      throw new OutboxRowSizeDefect({ expected: "custom item", value })
    }
    return recurse(item, value)
  },
  literal: (_type, values) =>
    // String literals lower to an enum tag, booleans to `bool`, numbers to
    // `f64`.
    typeof values[0] === "number" ? 8 : 1,
  primitive: (_type, kind, value) => {
    switch (kind) {
      case "string":
      case "bigint":
        if (typeof value !== "string") {
          throw new OutboxRowSizeDefect({ expected: "string", value })
        }
        return lengthPrefixBytes + utf8ByteLength(value)
      case "bytes":
        if (!(value instanceof Uint8Array)) {
          throw new OutboxRowSizeDefect({ expected: "bytes", value })
        }
        return lengthPrefixBytes + value.length
      default: {
        const bytes = fixedPrimitiveBytes[kind]
        if (bytes === undefined) {
          throw new OutboxRowSizeDefect({ expected: "primitive", value: kind })
        }
        return bytes
      }
    }
  },
})

class OutboxBacklogTargetDefect extends Data.TaggedError(
  "OutboxBacklogTargetDefect",
)<{
  readonly target: unknown
}> {}

/** One target's pending calls in one outbox. */
export type OutboxBacklogEntry = {
  readonly target: IdentityHex
  readonly pendingCount: number
  readonly oldestEnqueuedAt: Timestamp
  readonly oldestAgeMs: number
}

/**
 * Groups pending outbox rows by target: how many wait and how long the oldest
 * has. A stream whose oldest row keeps ageing is stuck: its target is
 * unreachable, refuses connections, or the row is over the host's request
 * limit, and the host retries it forever. Pure; `now` is the caller's clock.
 */
export const outboxBacklog = (
  rows: Iterable<{
    readonly target: Identity
    readonly enqueuedAt: Timestamp
  }>,
  now: Timestamp,
): ReadonlyArray<OutboxBacklogEntry> => {
  const byTarget = new Map<
    IdentityHex,
    { pendingCount: number; oldestEnqueuedAt: Timestamp }
  >()
  for (const row of rows) {
    const target = normalizeIdentity(row.target)
    if (Result.isFailure(target)) {
      // Rows come from our own outbox, whose target column holds identities.
      throw new OutboxBacklogTargetDefect({ target: target.failure })
    }
    const entry = byTarget.get(target.success)
    if (entry === undefined) {
      byTarget.set(target.success, {
        pendingCount: 1,
        oldestEnqueuedAt: row.enqueuedAt,
      })
      continue
    }
    entry.pendingCount += 1
    if (
      row.enqueuedAt.microsSinceUnixEpoch <
      entry.oldestEnqueuedAt.microsSinceUnixEpoch
    ) {
      entry.oldestEnqueuedAt = row.enqueuedAt
    }
  }

  return [...byTarget]
    .map(([target, entry]) => ({
      target,
      pendingCount: entry.pendingCount,
      oldestEnqueuedAt: entry.oldestEnqueuedAt,
      oldestAgeMs: Math.max(
        0,
        Number(
          (now.microsSinceUnixEpoch -
            entry.oldestEnqueuedAt.microsSinceUnixEpoch) /
            1_000n,
        ),
      ),
    }))
    .sort((left, right) => left.target.localeCompare(right.target))
}

/**
 * The calling database of an inter-database call: the transaction's sender
 * when it presented no JWT and is not this database. Only an inter-database
 * delivery reaches a reducer that way (the host builds every other caller from
 * a JWT, and a scheduled call is internal), and the sender is the calling
 * database's host-signed identity, which no client can claim. `None` for every
 * other caller.
 */
export const databaseCaller = (ctx: {
  readonly sender: Identity
  readonly senderAuth: ServerSenderAuth
}): Option.Option<Identity> =>
  !ctx.senderAuth.hasJWT && !ctx.senderAuth.isInternal
    ? Option.some(ctx.sender)
    : Option.none()
