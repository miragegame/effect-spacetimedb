import * as EffectVitest from "@effect/vitest"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"

const { expect } = EffectVitest

import * as Stdb from "effect-spacetimedb"
import { StdbDecodeError } from "effect-spacetimedb/server"
import * as StdbTesting from "effect-spacetimedb/testing"
import { ExampleErrors, UserId, UserMissing } from "../fixtures/full-module"
import { encodeJson } from "../helpers/json"
import { transform } from "../helpers/schema-transform"
import { TestLayer } from "../helpers/test-layer"

const describe = EffectVitest.layer(TestLayer)
const ErrorString = Stdb.string(
  Schema.String.pipe(Schema.check(Schema.isMaxLength(255))),
)

const decodeFailureCauseString = (
  exit: Exit.Exit<unknown, unknown>,
): string => {
  if (!Exit.isFailure(exit)) {
    return ""
  }

  const failure = exit.cause.pipe(Cause.findErrorOption, Option.getOrUndefined)
  return failure instanceof StdbDecodeError ? String(failure.cause) : ""
}

class NumericError extends Schema.TaggedErrorClass<NumericError>()(
  "NumericError",
  {
    value: Schema.Finite,
  },
) {}

class JsonBigIntError extends Schema.TaggedErrorClass<JsonBigIntError>()(
  "JsonBigIntError",
  {
    value: Schema.BigIntFromString,
  },
) {}

class MetadataRecordError extends Schema.TaggedErrorClass<MetadataRecordError>()(
  "MetadataRecordError",
  {
    metadata: Schema.Record(Schema.String, Schema.String),
  },
) {}

class MergeFirstError extends Schema.TaggedErrorClass<MergeFirstError>()(
  "MergeFirstError",
  {},
) {}

class MergeSharedError extends Schema.TaggedErrorClass<MergeSharedError>()(
  "MergeSharedError",
  {},
) {}

class MergeSecondError extends Schema.TaggedErrorClass<MergeSecondError>()(
  "MergeSecondError",
  {},
) {}

class JsonPayloadError extends Schema.TaggedErrorClass<JsonPayloadError>()(
  "JsonPayloadError",
  {
    occurredAt: Schema.DateFromString,
    labels: Schema.ReadonlySet(Schema.String),
    metadata: Schema.ReadonlyMap(Schema.String, Schema.Finite),
    bytes: Schema.Uint8Array,
  },
) {}

class toString extends Schema.TaggedErrorClass<toString>()("toString", {}) {}

class EncodedTagDropped extends Schema.TaggedErrorClass<EncodedTagDropped>()(
  "EncodedTagDropped",
  {
    code: Schema.String,
  },
) {}

class EncodedTagMismatch extends Schema.TaggedErrorClass<EncodedTagMismatch>()(
  "EncodedTagMismatch",
  {
    code: Schema.String,
  },
) {}

describe("error codec", (it) => {
  it.effect("derives an exact declared-error guard from the definition", () => {
    const guard = Stdb.declaredErrorGuard(ExampleErrors)
    const declared = UserMissing.make({
      userId: Schema.decodeUnknownSync(UserId)("user_1"),
    })

    expect(guard(declared)).toBe(true)
    expect(guard({ _tag: "NotDeclared" })).toBe(false)

    return Effect.void
  })

  it.effect("defines namespaced declared errors from Stdb.error specs", () =>
    Effect.gen(function* () {
      const NamespacedErrors = Stdb.errors.namespace("Namespaced")({
        UserMissing: Stdb.error({
          userId: ErrorString,
        }),
      })
      const error = NamespacedErrors.UserMissing.make({ userId: "user_1" })

      expect(error).toMatchObject({
        _tag: "NamespacedUserMissing",
        userId: "user_1",
      })
      expect(NamespacedErrors.tags.has("NamespacedUserMissing")).toBe(true)

      const encoded = yield* StdbTesting.ContractError.encodeString(
        NamespacedErrors,
        error,
      )
      const decoded = yield* StdbTesting.ContractError.decodeString(
        NamespacedErrors,
        encoded,
      )

      expect(decoded).toBeInstanceOf(NamespacedErrors.UserMissing)
      expect(NamespacedErrors.UserMissing.is(decoded)).toBe(true)
      expect(decoded).toMatchObject({
        _tag: "NamespacedUserMissing",
        userId: "user_1",
      })
    }),
  )

  it.effect(
    "normalizes array declared-error inputs like merged definitions",
    () =>
      Effect.gen(function* () {
        const FirstErrors = StdbTesting.ContractError.errors(
          MergeFirstError,
          MergeSharedError,
        )
        const SecondErrors = StdbTesting.ContractError.errors(
          MergeSharedError,
          MergeSecondError,
        )

        expect(
          StdbTesting.ContractError.normalizeErrorsInput(FirstErrors),
        ).toBe(FirstErrors)

        const NormalizedErrors = StdbTesting.ContractError.normalizeErrorsInput(
          [FirstErrors, SecondErrors, MergeSecondError],
        )
        const MergedErrors = StdbTesting.ContractError.merge(
          FirstErrors,
          SecondErrors,
        )

        expect(NormalizedErrors.errors).toEqual(MergedErrors.errors)
        expect([...NormalizedErrors.tags]).toEqual([...MergedErrors.tags])
      }),
  )

  it.effect("rejects invalid array declared-error inputs", () =>
    Effect.gen(function* () {
      class MergeFirstDuplicate extends Schema.TaggedErrorClass<MergeFirstDuplicate>()(
        "MergeFirstError",
        {},
      ) {}
      class RemoteRejectedError extends Schema.TaggedErrorClass<RemoteRejectedError>()(
        "RemoteRejectedError",
        {},
      ) {}

      expect(() =>
        StdbTesting.ContractError.normalizeErrorsInput([
          MergeFirstError,
          MergeFirstDuplicate,
        ]),
      ).toThrow(/duplicate error tag/i)
      expect(() =>
        StdbTesting.ContractError.normalizeErrorsInput([RemoteRejectedError]),
      ).toThrow(/reserved wrapper error tag/i)
    }),
  )

  it.effect(
    "reads declared HTTP status from generated and annotated classes",
    () =>
      Effect.gen(function* () {
        const StatusErrors = Stdb.errors.namespace("Status")({
          Missing: Stdb.error({}, { status: 404 }),
          Conflict: Stdb.error({}),
        })
        class AnnotatedStatus extends Schema.TaggedErrorClass<AnnotatedStatus>()(
          "AnnotatedStatus",
          {},
          { httpApiStatus: 418 },
        ) {}
        class StaticStatus extends Schema.TaggedErrorClass<StaticStatus>()(
          "StaticStatus",
          {},
          { httpApiStatus: 409 },
        ) {}
        Object.defineProperty(StaticStatus, "httpStatus", {
          configurable: true,
          enumerable: true,
          value: 451,
        })

        expect(StatusErrors.Missing.httpStatus).toBe(404)
        expect(StdbTesting.ContractError.statusOf(StatusErrors.Missing)).toBe(
          404,
        )
        expect(
          StdbTesting.ContractError.statusOf(StatusErrors.Conflict),
        ).toBeUndefined()
        expect(StdbTesting.ContractError.statusOf(AnnotatedStatus)).toBe(418)
        expect(StdbTesting.ContractError.statusOf(StaticStatus)).toBe(451)
      }),
  )

  it.effect("reads declared error tags without mutating schema classes", () =>
    Effect.gen(function* () {
      class IdentifierOnlyError extends Schema.TaggedErrorClass<IdentifierOnlyError>()(
        "IdentifierOnlyError",
        {
          code: Schema.String,
        },
      ) {}

      expect(
        Object.getOwnPropertyDescriptor(IdentifierOnlyError, "_tag"),
      ).toBeUndefined()
      expect(StdbTesting.ContractError.tagOf(IdentifierOnlyError)).toBe(
        "IdentifierOnlyError",
      )
      expect(StdbTesting.ContractError.tagOf(IdentifierOnlyError)).toBe(
        "IdentifierOnlyError",
      )
      expect(
        Object.getOwnPropertyDescriptor(IdentifierOnlyError, "_tag"),
      ).toBeUndefined()

      const IdentifierErrors =
        StdbTesting.ContractError.errors(IdentifierOnlyError)
      const matched = yield* StdbTesting.ContractError.matchEffect(
        IdentifierErrors,
        IdentifierOnlyError.make({ code: "E_IDENTIFIER" }),
      )

      expect(Option.getOrUndefined(matched)).toBeInstanceOf(IdentifierOnlyError)
    }),
  )

  it.effect("classifies namespaced auth declared errors by generated tag", () =>
    Effect.gen(function* () {
      const AuthErrors = Stdb.errors.namespace("Platform")({
        AuthMissingToken: Stdb.error({}),
      })
      const isAuthFailure = (value: unknown): boolean =>
        Predicate.isTagged(value, "PlatformAuthMissingToken")

      expect(isAuthFailure(AuthErrors.AuthMissingToken.make({}))).toBe(true)
    }),
  )

  it.effect(
    "matches and round-trips declared tagged errors through the schema",
    () =>
      Effect.gen(function* () {
        const error = UserMissing.make({ userId: "user_1" as never })
        const matched = yield* StdbTesting.ContractError.matchEffect(
          ExampleErrors,
          error,
        )

        expect(Option.isSome(matched)).toBe(true)
        expect(Option.getOrUndefined(matched)).toBeInstanceOf(UserMissing)

        const encoded = Schema.encodeSync(ExampleErrors.schema)(error)
        expect(encoded).toEqual({
          _tag: "UserMissing",
          userId: "user_1",
        })

        const decoded = Schema.decodeUnknownSync(ExampleErrors.schema)(encoded)
        expect(decoded).toBeInstanceOf(UserMissing)
        expect(decoded).toMatchObject({
          _tag: "UserMissing",
        })
      }),
  )

  it.effect(
    "rejects malformed declared-error payloads through the schema",
    () =>
      Effect.gen(function* () {
        const decoded = Schema.decodeUnknownOption(ExampleErrors.schema)({
          _tag: "UserMissing",
          userId: 123,
        })

        expect(Option.isNone(decoded)).toBe(true)
      }),
  )

  it.effect("round-trips declared reducer error strings", () =>
    Effect.gen(function* () {
      const encoded = yield* StdbTesting.ContractError.encodeString(
        ExampleErrors,
        UserMissing.make({ userId: "user_1" as never }),
      )

      const envelope = Schema.decodeUnknownSync(
        Schema.fromJsonString(Schema.Unknown),
      )(encoded)

      expect(envelope).toEqual({
        _effectSpacetimeDb: "DeclaredError",
        version: 1,
        tag: "UserMissing",
        error: {
          _tag: "UserMissing",
          userId: "user_1",
        },
      })

      const decoded = yield* StdbTesting.ContractError.decodeString(
        ExampleErrors,
        encoded,
      )
      expect(decoded).toBeInstanceOf(UserMissing)
      expect(decoded).toMatchObject({
        _tag: "UserMissing",
        userId: "user_1",
      })
    }),
  )

  it.effect(
    "enforces value-type declared-error fields through the JSON envelope",
    () =>
      Effect.gen(function* () {
        const TokenErrors = Stdb.errors.namespace("RawJson")({
          TokenRejected: Stdb.error({
            token: Stdb.string(
              Schema.String.pipe(Schema.check(Schema.isMaxLength(3))),
            ),
          }),
        })

        const encoded = yield* StdbTesting.ContractError.encodeString(
          TokenErrors,
          TokenErrors.TokenRejected.make({ token: "abc" }),
        )
        const decoded = yield* StdbTesting.ContractError.decodeString(
          TokenErrors,
          encoded,
        )
        expect(decoded).toMatchObject({
          _tag: "RawJsonTokenRejected",
          token: "abc",
        })

        const invalidEnvelope = encodeJson({
          _effectSpacetimeDb: "DeclaredError",
          version: 1,
          tag: "RawJsonTokenRejected",
          error: {
            _tag: "RawJsonTokenRejected",
            token: "abcd",
          },
        })
        const exit = yield* Effect.exit(
          StdbTesting.ContractError.decodeString(TokenErrors, invalidEnvelope),
        )

        expect(Exit.isFailure(exit)).toBe(true)
      }),
  )

  it.effect(
    "rejects legacy declared-error wrapper strings after the cutover",
    () =>
      Effect.gen(function* () {
        const legacyEncoded = encodeJson({
          _stdb_effect_error: 1,
          tag: "UserMissing",
          payload: {
            userId: "user_1",
          },
        })

        const exit = yield* Effect.exit(
          StdbTesting.ContractError.decodeString(ExampleErrors, legacyEncoded),
        )

        expect(Exit.isFailure(exit)).toBe(true)
      }),
  )

  it.effect("rejects declared-error envelopes with unknown tags", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(
        Schema.fromJsonString(Schema.Unknown),
      )({
        _effectSpacetimeDb: "DeclaredError",
        version: 1,
        tag: "NotDeclared",
        error: {
          _tag: "NotDeclared",
        },
      })

      const exit = yield* Effect.exit(
        StdbTesting.ContractError.decodeString(ExampleErrors, encoded),
      )

      expect(Exit.isFailure(exit)).toBe(true)
      expect(decodeFailureCauseString(exit)).toContain("not declared")
    }),
  )

  it.effect("fails fast when declared-error encoding drops _tag", () =>
    Effect.gen(function* () {
      const DroppedTagSchema = transform(
        Schema.Struct({
          code: Schema.String,
        }),
        EncodedTagDropped,
        {
          decode: ({ code }) => EncodedTagDropped.make({ code }),
          encode: (error) => ({
            code: error.code,
          }),
        },
      )
      const DroppedTagErrors = {
        errors: [EncodedTagDropped],
        tags: new Set(["EncodedTagDropped"]),
        schema: DroppedTagSchema,
        type: ErrorString,
      } as StdbTesting.ContractError.AnyErrorDefinition

      const exit = yield* Effect.exit(
        StdbTesting.ContractError.encodeString(
          DroppedTagErrors,
          EncodedTagDropped.make({ code: "missing-tag" }),
        ),
      )

      expect(Exit.isFailure(exit)).toBe(true)
      expect(decodeFailureCauseString(exit)).toContain("did not include a _tag")
    }),
  )

  it.effect("fails fast when declared-error encoding changes _tag", () =>
    Effect.gen(function* () {
      const MismatchedTagSchema = transform(
        Schema.TaggedStruct("EncodedTagDifferent", {
          code: Schema.String,
        }),
        EncodedTagMismatch,
        {
          decode: ({ code }) => EncodedTagMismatch.make({ code }),
          encode: (error) => ({
            _tag: "EncodedTagDifferent" as const,
            code: error.code,
          }),
        },
      )
      const MismatchedTagErrors = {
        errors: [EncodedTagMismatch],
        tags: new Set(["EncodedTagMismatch"]),
        schema: MismatchedTagSchema,
        type: ErrorString,
      } as StdbTesting.ContractError.AnyErrorDefinition

      const exit = yield* Effect.exit(
        StdbTesting.ContractError.encodeString(
          MismatchedTagErrors,
          EncodedTagMismatch.make({ code: "wrong-tag" }),
        ),
      )

      expect(Exit.isFailure(exit)).toBe(true)
      expect(decodeFailureCauseString(exit)).toContain("does not match")
    }),
  )

  it.effect("rejects duplicate and reserved declared error tags", () =>
    Effect.gen(function* () {
      const DuplicateTagA = (() => {
        class DuplicateTag extends Schema.TaggedErrorClass<DuplicateTag>()(
          "DuplicateTag",
          {},
        ) {}

        return DuplicateTag
      })()

      const DuplicateTagB = (() => {
        class DuplicateTag extends Schema.TaggedErrorClass<DuplicateTag>()(
          "DuplicateTag",
          {},
        ) {}

        return DuplicateTag
      })()

      class RemoteRejectedError extends Schema.TaggedErrorClass<RemoteRejectedError>()(
        "RemoteRejectedError",
        {},
      ) {}

      class StdbDeclaredErrorEncodingFailure extends Schema.TaggedErrorClass<StdbDeclaredErrorEncodingFailure>()(
        "StdbDeclaredErrorEncodingFailure",
        {},
      ) {}

      class StdbUniqueAlreadyExistsError extends Schema.TaggedErrorClass<StdbUniqueAlreadyExistsError>()(
        "StdbUniqueAlreadyExistsError",
        {},
      ) {}

      class StdbAutoIncOverflowError extends Schema.TaggedErrorClass<StdbAutoIncOverflowError>()(
        "StdbAutoIncOverflowError",
        {},
      ) {}

      class StdbNoSuchRowError extends Schema.TaggedErrorClass<StdbNoSuchRowError>()(
        "StdbNoSuchRowError",
        {},
      ) {}

      class StdbScheduleDelayTooLongError extends Schema.TaggedErrorClass<StdbScheduleDelayTooLongError>()(
        "StdbScheduleDelayTooLongError",
        {},
      ) {}

      class StdbValueCodecError extends Schema.TaggedErrorClass<StdbValueCodecError>()(
        "StdbValueCodecError",
        {},
      ) {}

      class ReducerGlobalRandomNotAllowedError extends Schema.TaggedErrorClass<ReducerGlobalRandomNotAllowedError>()(
        "ReducerGlobalRandomNotAllowedError",
        {},
      ) {}

      class GeneratedArtifactShapeError extends Schema.TaggedErrorClass<GeneratedArtifactShapeError>()(
        "GeneratedArtifactShapeError",
        {},
      ) {}

      expect(() =>
        StdbTesting.ContractError.errors(DuplicateTagA, DuplicateTagB),
      ).toThrow(/duplicate error tag/i)
      expect(() =>
        StdbTesting.ContractError.errors(RemoteRejectedError),
      ).toThrow(/reserved/i)
      expect(() =>
        StdbTesting.ContractError.errors(StdbDeclaredErrorEncodingFailure),
      ).toThrow(/reserved/i)
      expect(() =>
        StdbTesting.ContractError.errors(StdbUniqueAlreadyExistsError),
      ).toThrow(/reserved/i)
      expect(() =>
        StdbTesting.ContractError.errors(StdbAutoIncOverflowError),
      ).toThrow(/reserved/i)
      expect(() =>
        StdbTesting.ContractError.errors(StdbNoSuchRowError),
      ).toThrow(/reserved/i)
      expect(() =>
        StdbTesting.ContractError.errors(StdbScheduleDelayTooLongError),
      ).toThrow(/reserved/i)
      expect(() =>
        StdbTesting.ContractError.errors(StdbValueCodecError),
      ).toThrow(/reserved/i)
      expect(() =>
        StdbTesting.ContractError.errors(ReducerGlobalRandomNotAllowedError),
      ).toThrow(/reserved/i)
      expect(() =>
        StdbTesting.ContractError.errors(GeneratedArtifactShapeError),
      ).toThrow(/reserved/i)
    }),
  )

  it.effect(
    "rejects modules that map one declared tag to different error classes",
    () =>
      Effect.gen(function* () {
        const SharedDeclaredOne = (() => {
          class SharedDeclared extends Schema.TaggedErrorClass<SharedDeclared>()(
            "SharedDeclared",
            {},
          ) {}

          return SharedDeclared
        })()

        const SharedDeclaredTwo = (() => {
          class SharedDeclared extends Schema.TaggedErrorClass<SharedDeclared>()(
            "SharedDeclared",
            {},
          ) {}

          return SharedDeclared
        })()

        const FirstErrors = StdbTesting.ContractError.errors(SharedDeclaredOne)
        const SecondErrors = StdbTesting.ContractError.errors(SharedDeclaredTwo)

        expect(() =>
          StdbTesting.ContractError.merge(FirstErrors, SecondErrors),
        ).toThrow(/duplicate error tag/i)
        expect(
          () =>
            Stdb.StdbModule.make("duplicate_declaredError_mapping", {}).add(
              Stdb.StdbGroup.make("DuplicateDeclaredErrors")
                .add(
                  Stdb.StdbFn.reducer("first", {
                    params: Stdb.struct({}),
                    errors: FirstErrors,
                  }),
                )
                .add(
                  Stdb.StdbFn.procedure("second", {
                    params: Stdb.struct({}),
                    returns: Stdb.unit(),
                    errors: SecondErrors,
                  }),
                ),
            ).spec,
        ).toThrow(/different error classes/)
      }),
  )

  it.effect(
    "merges declared-error definitions with shared classes by identity",
    () =>
      Effect.gen(function* () {
        const FirstErrors = StdbTesting.ContractError.errors(
          MergeFirstError,
          MergeSharedError,
        )
        const SecondErrors = StdbTesting.ContractError.errors(
          MergeSharedError,
          MergeSecondError,
        )
        const MergedErrors = StdbTesting.ContractError.merge(
          FirstErrors,
          SecondErrors,
        )
        const HandSpreadErrors = StdbTesting.ContractError.errors(
          MergeFirstError,
          MergeSharedError,
          MergeSecondError,
        )

        expect(() =>
          StdbTesting.ContractError.errors(
            MergeFirstError,
            MergeSharedError,
            MergeSharedError,
            MergeSecondError,
          ),
        ).toThrow(/duplicate error tag/i)
        expect(MergedErrors.errors).toEqual(HandSpreadErrors.errors)
        expect([...MergedErrors.tags]).toEqual([...HandSpreadErrors.tags])

        const encoded = yield* StdbTesting.ContractError.encodeString(
          MergedErrors,
          MergeSecondError.make({}),
        )
        const decoded = yield* StdbTesting.ContractError.decodeString(
          MergedErrors,
          encoded,
        )

        expect(decoded).toBeInstanceOf(MergeSecondError)
        expect(decoded).toMatchObject({
          _tag: "MergeSecondError",
        })
      }),
  )

  it.effect("supports typed declared-error picks from a shared registry", () =>
    Effect.gen(function* () {
      const RuntimePayloadErrors = StdbTesting.ContractError.errors(
        NumericError,
        JsonBigIntError,
      )
      const NumericOnly = RuntimePayloadErrors.pick("NumericError")
      const error = NumericError.make({ value: 3.5 as never })

      expect([...NumericOnly.tags]).toEqual(["NumericError"])

      const encoded = yield* StdbTesting.ContractError.encodeString(
        NumericOnly,
        error,
      )
      const decoded = yield* StdbTesting.ContractError.decodeString(
        NumericOnly,
        encoded,
      )

      expect(decoded).toBeInstanceOf(NumericError)
      expect(decoded).toMatchObject({
        _tag: "NumericError",
        value: 3.5,
      })
    }),
  )

  it.effect(
    "does not invoke inherited prototype members as domain handlers",
    () =>
      Effect.gen(function* () {
        const PrototypeTagErrors = StdbTesting.ContractError.errors(toString)
        const error = toString.make({})
        const exit = yield* new StdbTesting.DomainCallError({ error }).pipe(
          Effect.fail,
          StdbTesting.catchRawTags(PrototypeTagErrors, {}),
          Effect.exit,
        )

        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) {
          const failure = exit.cause.pipe(
            Cause.findErrorOption,
            Option.getOrUndefined,
          )
          expect(failure).toBeInstanceOf(StdbTesting.DomainCallError)
          if (failure instanceof StdbTesting.DomainCallError) {
            expect(failure.error).toBe(error)
          }
        }
      }),
  )

  it.effect(
    "supports numeric and JSON-safe bigint declared error payloads",
    () =>
      Effect.gen(function* () {
        const NumericErrors = StdbTesting.ContractError.errors(NumericError)
        const BigIntErrors = StdbTesting.ContractError.errors(JsonBigIntError)

        expect(
          Schema.encodeSync(NumericErrors.schema)(
            NumericError.make({ value: 1.5 as never }),
          ),
        ).toEqual({
          _tag: "NumericError",
          value: 1.5,
        })

        expect(
          Schema.encodeSync(BigIntErrors.schema)(
            JsonBigIntError.make({ value: 42n as never }),
          ),
        ).toEqual({
          _tag: "JsonBigIntError",
          value: "42",
        })

        const decoded = Schema.decodeUnknownSync(BigIntErrors.schema)({
          _tag: "JsonBigIntError",
          value: "42",
        })

        expect(decoded).toBeInstanceOf(JsonBigIntError)
        expect(decoded).toMatchObject({
          _tag: "JsonBigIntError",
          value: 42n,
        })

        const encodedString = yield* StdbTesting.ContractError.encodeString(
          BigIntErrors,
          JsonBigIntError.make({ value: 42n as never }),
        )

        const decodedString = yield* StdbTesting.ContractError.decodeString(
          BigIntErrors,
          encodedString,
        )

        expect(decodedString).toBeInstanceOf(JsonBigIntError)
        expect(decodedString).toMatchObject({
          _tag: "JsonBigIntError",
          value: 42n,
        })
      }),
  )

  it.effect(
    "supports declared error payloads that are not SATS-lowerable",
    () =>
      Effect.gen(function* () {
        const MetadataErrors =
          StdbTesting.ContractError.errors(MetadataRecordError)
        const encoded = yield* StdbTesting.ContractError.encodeString(
          MetadataErrors,
          MetadataRecordError.make({
            metadata: {
              region: "iad",
              shard: "blue",
            } as never,
          }),
        )

        const decoded = yield* StdbTesting.ContractError.decodeString(
          MetadataErrors,
          encoded,
        )

        expect(decoded).toBeInstanceOf(MetadataRecordError)
        expect(decoded).toMatchObject({
          _tag: "MetadataRecordError",
          metadata: {
            region: "iad",
            shard: "blue",
          },
        })
      }),
  )

  it.effect("supports JSON-safe rich payloads in declared error strings", () =>
    (() => {
      const occurredAt = new Date("2026-01-02T03:04:05.000Z")

      return Effect.gen(function* () {
        const RuntimePayloadErrors =
          StdbTesting.ContractError.errors(JsonPayloadError)
        const encoded = yield* StdbTesting.ContractError.encodeString(
          RuntimePayloadErrors,
          JsonPayloadError.make({
            occurredAt: occurredAt as never,
            labels: new Set(["primary", "beta"]) as never,
            metadata: new Map([
              ["retries", 2],
              ["shards", 4],
            ]) as never,
            bytes: new Uint8Array([1, 2, 3, 255]) as never,
          }),
        )

        const decoded = yield* StdbTesting.ContractError.decodeString(
          RuntimePayloadErrors,
          encoded,
        )

        expect(decoded).toBeInstanceOf(JsonPayloadError)
        expect(decoded.occurredAt.toISOString()).toBe(occurredAt.toISOString())
        expect(Array.from(decoded.labels.values()).sort()).toEqual([
          "beta",
          "primary",
        ])
        expect(Array.from(decoded.metadata.entries())).toEqual([
          ["retries", 2],
          ["shards", 4],
        ])
        expect(Array.from(decoded.bytes)).toEqual([1, 2, 3, 255])
      })
    })(),
  )
})
