import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import { ConnectionId, Identity, Uuid } from "spacetimedb"
import * as Type from "../contract/type.ts"
import {
  isViewParamKind,
  type ViewParamKind,
  viewParamWireKind,
} from "../contract/view.ts"
import { StdbDecodeError } from "../decode-error.ts"
import * as ValueCodec from "./value-codec.ts"

/**
 * The subscription SQL for one call of a view that takes arguments:
 * `SELECT * FROM "view_name"(arg, ...)`, the only query SpacetimeDB 2.13 runs on
 * such a view. Arguments are positional, in the order the params struct
 * declares its fields, which is the order the module compiled them in; each
 * is encoded as a WebSocket argument first, so branded and class-backed
 * values reach SQL as their wire form.
 */
export const viewCallSql = (
  name: string,
  params: Type.StructLikeValueType,
  args: unknown,
): Effect.Effect<string, StdbDecodeError> =>
  Effect.gen(function* () {
    const fields = Type.structFields(params)
    if (fields == null) {
      return yield* argsFailure(`View ${name} params are not a struct`)
    }
    const encoded = yield* ValueCodec.ws.encode(params, args)
    if (typeof encoded !== "object" || encoded === null) {
      return yield* argsFailure(`View ${name} arguments encoded to no object`)
    }
    const literals = yield* Effect.forEach(
      Object.entries(fields),
      ([fieldName, field]) => {
        const kind = viewParamWireKind(field)
        return kind !== undefined && isViewParamKind(kind)
          ? sqlLiteral(kind, Reflect.get(encoded, fieldName))
          : argsFailure(
              `View ${name} param ${fieldName} has no SQL literal (${kind ?? "unknown type"})`,
            )
      },
      { concurrency: 1 },
    )
    // Quoted as the SDK quotes every relation it names: a wire name that is
    // a keyword in table position (`unnest`, `lateral`) parses only quoted.
    return `SELECT * FROM ${quotedIdentifier(name)}(${literals.join(", ")})`
  })

const argsFailure = (message: string) =>
  Effect.fail(new StdbDecodeError({ phase: "args", cause: new Error(message) }))

// PostgreSQL syntax, which SpacetimeDB's parser uses: a quote doubles, and a
// backslash is an ordinary character.
const quoted = (text: string): string => `'${text.replaceAll("'", "''")}'`
const quotedIdentifier = (name: string): string =>
  `"${name.replaceAll('"', '""')}"`

// A decimal, as upstream's query builder writes one: the host parses a
// numeric literal, a negative one included, against the param's type at any
// width. Identities, connection ids and UUIDs travel as their text, which the
// host parses against the type the same way.
const integerLiteral = (value: unknown) =>
  (typeof value === "number" && Number.isSafeInteger(value)) ||
  typeof value === "bigint"
    ? Effect.succeed(String(value))
    : argsFailure(`An integer view argument encoded to ${typeof value}`)

const sqlLiteral = (
  kind: ViewParamKind,
  value: unknown,
): Effect.Effect<string, StdbDecodeError> =>
  Match.value(kind).pipe(
    Match.when("bool", () =>
      typeof value === "boolean"
        ? Effect.succeed(value ? "true" : "false")
        : argsFailure(`A bool view argument encoded to ${typeof value}`),
    ),
    Match.when("string", () =>
      typeof value === "string"
        ? Effect.succeed(quoted(value))
        : argsFailure(`A string view argument encoded to ${typeof value}`),
    ),
    Match.when("identity", () =>
      value instanceof Identity
        ? Effect.succeed(quoted(value.toHexString()))
        : argsFailure("An identity view argument encoded to no Identity"),
    ),
    Match.when("connectionId", () =>
      value instanceof ConnectionId
        ? Effect.succeed(quoted(value.toHexString()))
        : argsFailure(
            "A connection id view argument encoded to no ConnectionId",
          ),
    ),
    Match.when("uuid", () =>
      value instanceof Uuid
        ? Effect.succeed(quoted(value.toString()))
        : argsFailure("A UUID view argument encoded to no Uuid"),
    ),
    Match.whenOr(
      "i8",
      "i16",
      "i32",
      "i64",
      "i128",
      "i256",
      "u8",
      "u16",
      "u32",
      "u64",
      "u128",
      "u256",
      () => integerLiteral(value),
    ),
    Match.exhaustive,
  )
