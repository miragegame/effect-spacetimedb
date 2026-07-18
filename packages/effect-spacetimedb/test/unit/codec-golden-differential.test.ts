import * as EffectVitest from "@effect/vitest"
import * as Cause from "effect/Cause"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as FastCheck from "effect/testing/FastCheck"
import * as StdbTesting from "effect-spacetimedb/testing"
import {
  decodeHostValue,
  encodeGeneratedClientValue,
} from "../../src/contract/type/host-codec.ts"
import { ExampleErrors } from "../fixtures/full-module.ts"
import { TestLayer } from "../helpers/test-layer.ts"
import { corpusArbitraries } from "../helpers/value-type-arbitrary.ts"

const { expect } = EffectVitest
const describe = EffectVitest.layer(TestLayer)
const T = StdbTesting.ContractType

const generatedValueSeed = 0x51d0_2026

type FailureSnapshot = {
  readonly tag: string
  readonly message: string
  readonly cause?: FailureSnapshot
  readonly issue?: unknown
}

class CodecGoldenSyncThrown extends Data.TaggedError("CodecGoldenSyncThrown")<{
  readonly cause: unknown
}> {}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Object.prototype.toString.call(value) === "[object Object]"

const stableValue = (value: unknown): unknown => {
  if (typeof value === "bigint") {
    return `${value}n`
  }
  if (value instanceof Uint8Array) {
    return {
      type: "Uint8Array",
      values: Array.from(value),
    }
  }
  if (Array.isArray(value)) {
    return value.map(stableValue)
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, stableValue(entry)]),
    )
  }
  if (
    typeof value === "object" &&
    value !== null &&
    value.constructor !== Object
  ) {
    return {
      type: value.constructor.name,
      value: String(value),
    }
  }
  return value
}

const issueSnapshot = (issue: unknown): unknown => {
  if (issue instanceof Error) {
    return {
      tag: issue.constructor.name,
      message: issue.message,
    }
  }
  if (!isPlainObject(issue)) {
    return stableValue(issue)
  }

  const entries = Object.entries(issue).filter(
    ([key]) =>
      key === "_tag" ||
      key === "message" ||
      key === "path" ||
      key === "actual" ||
      key === "ast" ||
      key === "issue" ||
      key === "issues",
  )
  return {
    tag: issue.constructor.name,
    ...Object.fromEntries(
      entries.map(([key, value]) => [key, stableValue(value)]),
    ),
  }
}

const failureSnapshot = (cause: unknown): FailureSnapshot => {
  if (cause instanceof CodecGoldenSyncThrown) {
    return failureSnapshot(cause.cause)
  }
  if (cause instanceof StdbTesting.StdbDecodeError) {
    return {
      tag: "StdbDecodeError",
      message: cause.message,
      cause: failureSnapshot(cause.cause),
    }
  }
  if (Schema.isSchemaError(cause)) {
    return {
      tag: "SchemaError",
      message: cause.message,
      issue: issueSnapshot(cause.issue),
    }
  }
  if (cause instanceof Error) {
    return {
      tag: cause.constructor.name,
      message: cause.message,
      ...(cause.cause === undefined
        ? {}
        : { cause: failureSnapshot(cause.cause) }),
    }
  }
  return {
    tag: typeof cause,
    message: String(cause),
  }
}

const exitFailureSnapshot = <A, E>(exit: Exit.Exit<A, E>): FailureSnapshot => {
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isSuccess(exit)) {
    throw new Error("Expected failure exit")
  }

  const failure = exit.cause.pipe(Cause.findErrorOption, Option.getOrUndefined)
  if (failure !== undefined) {
    return failureSnapshot(failure)
  }

  const defect = exit.cause.reasons
    .filter(Cause.isDieReason)
    .map((reason) => reason.defect)[0]
  return failureSnapshot(defect)
}

const syncExit = <A>(
  run: () => A,
): Effect.Effect<Exit.Exit<A, CodecGoldenSyncThrown>> =>
  Effect.exit(
    Effect.try({
      try: run,
      catch: (cause) => new CodecGoldenSyncThrown({ cause }),
    }),
  )

const generatedCorpus = corpusArbitraries.map(
  ({ kind, type, valueArbitrary }, index) => {
    const samples = FastCheck.sample(valueArbitrary, {
      seed: generatedValueSeed + index,
      numRuns: 24,
    })
    const value =
      kind === "f32" || kind === "f64"
        ? samples.find(
            (sample): sample is number =>
              typeof sample === "number" && Number.isFinite(sample),
          )
        : samples[0]
    if ((kind === "f32" || kind === "f64") && value === undefined) {
      throw new Error(`Failed to generate valid sample for ${kind}`)
    }
    return { kind, type, value }
  },
)

describe("codec golden differential", (it) => {
  it.effect("pins fixed-seed generated values across envelope paths", () =>
    Effect.gen(function* () {
      const snapshots = yield* Effect.forEach(
        generatedCorpus,
        Effect.fn(function* ({ kind, type, value }) {
          const hostEncoded = StdbTesting.encodeHostValue(type, value)
          const hostDecoded = decodeHostValue(type, hostEncoded)
          const wireEncoded = yield* Schema.encodeEffect(type.schema)(
            value as never,
          )
          const wireDecoded = yield* Schema.decodeUnknownEffect(type.schema)(
            wireEncoded,
          )
          const httpPrepared = StdbTesting.ClientHttpJson.prepareHttpInputValue(
            type,
            wireEncoded,
          )
          const httpBody = T.isUnitValueType(type)
            ? "[]"
            : StdbTesting.ClientHttpJson.encodeHttpInput(httpPrepared)
          const httpDecoded =
            yield* StdbTesting.ClientValueCodec.httpJson.decodeOutput(
              type,
              httpBody,
            )
          const envelope = StdbTesting.procedureEnvelope(type, ExampleErrors)
          const procedureEncoded = yield* Schema.encodeEffect(envelope.schema)({
            tag: "ok",
            value,
          } as never)
          const procedureDecoded = yield* Schema.decodeUnknownEffect(
            envelope.schema,
          )(procedureEncoded)

          expect(hostDecoded).toEqual(value)
          expect(wireDecoded).toEqual(value)
          expect(httpDecoded).toEqual(value)
          expect(procedureDecoded).toEqual(
            T.isAuthoredUnitValueType(type)
              ? { tag: "ok" }
              : { tag: "ok", value },
          )

          return {
            kind,
            hostEncoded: stableValue(hostEncoded),
            wireEncoded: stableValue(wireEncoded),
            httpPrepared: stableValue(httpPrepared),
            httpBody,
            procedureEncoded: stableValue(procedureEncoded),
          }
        }),
      )

      expect(snapshots).toMatchInlineSnapshot(`
        [
          {
            "hostEncoded": [
              14897,
              65533,
              4,
              52854,
              15,
            ],
            "httpBody": "[14897,65533,4,52854,15]",
            "httpPrepared": [
              14897,
              65533,
              4,
              52854,
              15,
            ],
            "kind": "array",
            "procedureEncoded": {
              "tag": "ok",
              "value": [
                14897,
                65533,
                4,
                52854,
                15,
              ],
            },
            "wireEncoded": [
              14897,
              65533,
              4,
              52854,
              15,
            ],
          },
          {
            "hostEncoded": "-7",
            "httpBody": ""-7"",
            "httpPrepared": "-7",
            "kind": "bigint",
            "procedureEncoded": {
              "tag": "ok",
              "value": "-7",
            },
            "wireEncoded": "-7",
          },
          {
            "hostEncoded": true,
            "httpBody": "true",
            "httpPrepared": true,
            "kind": "bool",
            "procedureEncoded": {
              "tag": "ok",
              "value": true,
            },
            "wireEncoded": true,
          },
          {
            "hostEncoded": {
              "type": "Uint8Array",
              "values": [
                129,
                180,
                114,
                154,
                126,
                116,
              ],
            },
            "httpBody": "[129,180,114,154,126,116]",
            "httpPrepared": {
              "type": "Uint8Array",
              "values": [
                129,
                180,
                114,
                154,
                126,
                116,
              ],
            },
            "kind": "bytes",
            "procedureEncoded": {
              "tag": "ok",
              "value": {
                "type": "Uint8Array",
                "values": [
                  129,
                  180,
                  114,
                  154,
                  126,
                  116,
                ],
              },
            },
            "wireEncoded": {
              "type": "Uint8Array",
              "values": [
                129,
                180,
                114,
                154,
                126,
                116,
              ],
            },
          },
          {
            "hostEncoded": {
              "__connection_id__": "340282366920938463463374607431768211416n",
            },
            "httpBody": "{"__connection_id__":340282366920938463463374607431768211416}",
            "httpPrepared": {
              "__connection_id__": "340282366920938463463374607431768211416n",
            },
            "kind": "connectionId",
            "procedureEncoded": {
              "tag": "ok",
              "value": {
                "__connection_id__": "340282366920938463463374607431768211416n",
              },
            },
            "wireEncoded": {
              "__connection_id__": "340282366920938463463374607431768211416n",
            },
          },
          {
            "hostEncoded": "y",
            "httpBody": ""y"",
            "httpPrepared": "y",
            "kind": "custom",
            "procedureEncoded": {
              "tag": "ok",
              "value": "y",
            },
            "wireEncoded": "y",
          },
          {
            "hostEncoded": -3.8443447931995516e-16,
            "httpBody": "-3.8443447931995516e-16",
            "httpPrepared": -3.8443447931995516e-16,
            "kind": "f32",
            "procedureEncoded": {
              "tag": "ok",
              "value": -3.8443447931995516e-16,
            },
            "wireEncoded": -3.8443447931995516e-16,
          },
          {
            "hostEncoded": 9.4e-323,
            "httpBody": "9.4e-323",
            "httpPrepared": 9.4e-323,
            "kind": "f64",
            "procedureEncoded": {
              "tag": "ok",
              "value": 9.4e-323,
            },
            "wireEncoded": 9.4e-323,
          },
          {
            "hostEncoded": {
              "__identity__": "57485404742675281882362890992508406424835323542050502958030236741698827983048n",
            },
            "httpBody": "{"__identity__":57485404742675281882362890992508406424835323542050502958030236741698827983048}",
            "httpPrepared": {
              "__identity__": "57485404742675281882362890992508406424835323542050502958030236741698827983048n",
            },
            "kind": "identity",
            "procedureEncoded": {
              "tag": "ok",
              "value": {
                "__identity__": "57485404742675281882362890992508406424835323542050502958030236741698827983048n",
              },
            },
            "wireEncoded": {
              "__identity__": "57485404742675281882362890992508406424835323542050502958030236741698827983048n",
            },
          },
          {
            "hostEncoded": 7,
            "httpBody": "7",
            "httpPrepared": 7,
            "kind": "i8",
            "procedureEncoded": {
              "tag": "ok",
              "value": 7,
            },
            "wireEncoded": 7,
          },
          {
            "hostEncoded": -5,
            "httpBody": "-5",
            "httpPrepared": -5,
            "kind": "i16",
            "procedureEncoded": {
              "tag": "ok",
              "value": -5,
            },
            "wireEncoded": -5,
          },
          {
            "hostEncoded": 24,
            "httpBody": "24",
            "httpPrepared": 24,
            "kind": "i32",
            "procedureEncoded": {
              "tag": "ok",
              "value": 24,
            },
            "wireEncoded": 24,
          },
          {
            "hostEncoded": "-33491388104181700n",
            "httpBody": "-33491388104181700",
            "httpPrepared": "-33491388104181700n",
            "kind": "i64",
            "procedureEncoded": {
              "tag": "ok",
              "value": "-33491388104181700n",
            },
            "wireEncoded": "-33491388104181700n",
          },
          {
            "hostEncoded": "-116379241622794392423262057171372646189n",
            "httpBody": "-116379241622794392423262057171372646189",
            "httpPrepared": "-116379241622794392423262057171372646189n",
            "kind": "i128",
            "procedureEncoded": {
              "tag": "ok",
              "value": "-116379241622794392423262057171372646189n",
            },
            "wireEncoded": "-116379241622794392423262057171372646189n",
          },
          {
            "hostEncoded": "38996609056757154658409387165342785510449383089465162836062298843214449613005n",
            "httpBody": "38996609056757154658409387165342785510449383089465162836062298843214449613005",
            "httpPrepared": "38996609056757154658409387165342785510449383089465162836062298843214449613005n",
            "kind": "i256",
            "procedureEncoded": {
              "tag": "ok",
              "value": "38996609056757154658409387165342785510449383089465162836062298843214449613005n",
            },
            "wireEncoded": "38996609056757154658409387165342785510449383089465162836062298843214449613005n",
          },
          {
            "hostEncoded": {
              "children": [
                {
                  "children": [
                    {
                      "children": [
                        {
                          "children": [],
                          "name": "t\\:3F&",
                        },
                        {
                          "children": [],
                          "name": "h",
                        },
                      ],
                      "name": "u\`4AL>zn",
                    },
                    {
                      "children": [
                        {
                          "children": [],
                          "name": "LA$)",
                        },
                        {
                          "children": [],
                          "name": "a==G",
                        },
                      ],
                      "name": "GgG1]",
                    },
                  ],
                  "name": "?UH",
                },
                {
                  "children": [
                    {
                      "children": [
                        {
                          "children": [],
                          "name": "(~Q)",
                        },
                      ],
                      "name": "/Li",
                    },
                  ],
                  "name": "oe$",
                },
              ],
              "name": "4pw(Y;.",
            },
            "httpBody": "{"name":"4pw(Y;.","children":[{"name":"?UH","children":[{"name":"u\`4AL>zn","children":[{"name":"t\\\\:3F&","children":[]},{"name":"h","children":[]}]},{"name":"GgG1]","children":[{"name":"LA$)","children":[]},{"name":"a==G","children":[]}]}]},{"name":"oe$","children":[{"name":"/Li","children":[{"name":"(~Q)","children":[]}]}]}]}",
            "httpPrepared": {
              "children": [
                {
                  "children": [
                    {
                      "children": [
                        {
                          "children": [],
                          "name": "t\\:3F&",
                        },
                        {
                          "children": [],
                          "name": "h",
                        },
                      ],
                      "name": "u\`4AL>zn",
                    },
                    {
                      "children": [
                        {
                          "children": [],
                          "name": "LA$)",
                        },
                        {
                          "children": [],
                          "name": "a==G",
                        },
                      ],
                      "name": "GgG1]",
                    },
                  ],
                  "name": "?UH",
                },
                {
                  "children": [
                    {
                      "children": [
                        {
                          "children": [],
                          "name": "(~Q)",
                        },
                      ],
                      "name": "/Li",
                    },
                  ],
                  "name": "oe$",
                },
              ],
              "name": "4pw(Y;.",
            },
            "kind": "lazy",
            "procedureEncoded": {
              "tag": "ok",
              "value": {
                "children": [
                  {
                    "children": [
                      {
                        "children": [
                          {
                            "children": [],
                            "name": "t\\:3F&",
                          },
                          {
                            "children": [],
                            "name": "h",
                          },
                        ],
                        "name": "u\`4AL>zn",
                      },
                      {
                        "children": [
                          {
                            "children": [],
                            "name": "LA$)",
                          },
                          {
                            "children": [],
                            "name": "a==G",
                          },
                        ],
                        "name": "GgG1]",
                      },
                    ],
                    "name": "?UH",
                  },
                  {
                    "children": [
                      {
                        "children": [
                          {
                            "children": [],
                            "name": "(~Q)",
                          },
                        ],
                        "name": "/Li",
                      },
                    ],
                    "name": "oe$",
                  },
                ],
                "name": "4pw(Y;.",
              },
            },
            "wireEncoded": {
              "children": [
                {
                  "children": [
                    {
                      "children": [
                        {
                          "children": [],
                          "name": "t\\:3F&",
                        },
                        {
                          "children": [],
                          "name": "h",
                        },
                      ],
                      "name": "u\`4AL>zn",
                    },
                    {
                      "children": [
                        {
                          "children": [],
                          "name": "LA$)",
                        },
                        {
                          "children": [],
                          "name": "a==G",
                        },
                      ],
                      "name": "GgG1]",
                    },
                  ],
                  "name": "?UH",
                },
                {
                  "children": [
                    {
                      "children": [
                        {
                          "children": [],
                          "name": "(~Q)",
                        },
                      ],
                      "name": "/Li",
                    },
                  ],
                  "name": "oe$",
                },
              ],
              "name": "4pw(Y;.",
            },
          },
          {
            "hostEncoded": {
              "tag": "joined",
            },
            "httpBody": "{"joined":{}}",
            "httpPrepared": {
              "joined": {},
            },
            "kind": "literal",
            "procedureEncoded": {
              "tag": "ok",
              "value": {
                "tag": "joined",
              },
            },
            "wireEncoded": {
              "tag": "joined",
            },
          },
          {
            "hostEncoded": undefined,
            "httpBody": "{"none":{}}",
            "httpPrepared": {
              "none": {},
            },
            "kind": "option",
            "procedureEncoded": {
              "tag": "ok",
              "value": {
                "none": {},
              },
            },
            "wireEncoded": {
              "none": {},
            },
          },
          {
            "hostEncoded": {
              "err": "gqL",
            },
            "httpBody": "{"err":"gqL"}",
            "httpPrepared": {
              "err": "gqL",
            },
            "kind": "result",
            "procedureEncoded": {
              "tag": "ok",
              "value": {
                "tag": "err",
                "value": "gqL",
              },
            },
            "wireEncoded": {
              "tag": "err",
              "value": "gqL",
            },
          },
          {
            "hostEncoded": {
              "tag": "Time",
              "value": {
                "__timestamp_micros_since_unix_epoch__": "-3829917604290921492n",
              },
            },
            "httpBody": "{"tag":"Time","value":{"__timestamp_micros_since_unix_epoch__":-3829917604290921492}}",
            "httpPrepared": {
              "tag": "Time",
              "value": {
                "__timestamp_micros_since_unix_epoch__": "-3829917604290921492n",
              },
            },
            "kind": "scheduleAt",
            "procedureEncoded": {
              "tag": "ok",
              "value": {
                "tag": "Time",
                "value": {
                  "__timestamp_micros_since_unix_epoch__": "-3829917604290921492n",
                },
              },
            },
            "wireEncoded": {
              "tag": "Time",
              "value": {
                "__timestamp_micros_since_unix_epoch__": "-3829917604290921492n",
              },
            },
          },
          {
            "hostEncoded": "__",
            "httpBody": ""__"",
            "httpPrepared": "__",
            "kind": "string",
            "procedureEncoded": {
              "tag": "ok",
              "value": "__",
            },
            "wireEncoded": "__",
          },
          {
            "hostEncoded": {
              "count": 4294967270,
              "id": "$",
            },
            "httpBody": "{"id":"$","count":4294967270}",
            "httpPrepared": {
              "count": 4294967270,
              "id": "$",
            },
            "kind": "struct",
            "procedureEncoded": {
              "tag": "ok",
              "value": {
                "count": 4294967270,
                "id": "$",
              },
            },
            "wireEncoded": {
              "count": 4294967270,
              "id": "$",
            },
          },
          {
            "hostEncoded": {
              "tag": "named",
              "value": {
                "label": "key",
              },
            },
            "httpBody": "{"named":{"label":"key"}}",
            "httpPrepared": {
              "named": {
                "label": "key",
              },
            },
            "kind": "sum",
            "procedureEncoded": {
              "tag": "ok",
              "value": {
                "named": {
                  "label": "key",
                },
              },
            },
            "wireEncoded": {
              "named": {
                "label": "key",
              },
            },
          },
          {
            "hostEncoded": {
              "__time_duration_micros__": "-9223372036854775799n",
            },
            "httpBody": "{"__time_duration_micros__":-9223372036854775799}",
            "httpPrepared": {
              "__time_duration_micros__": "-9223372036854775799n",
            },
            "kind": "timeDuration",
            "procedureEncoded": {
              "tag": "ok",
              "value": {
                "__time_duration_micros__": "-9223372036854775799n",
              },
            },
            "wireEncoded": {
              "__time_duration_micros__": "-9223372036854775799n",
            },
          },
          {
            "hostEncoded": {
              "__timestamp_micros_since_unix_epoch__": "4906118344041638152n",
            },
            "httpBody": "{"__timestamp_micros_since_unix_epoch__":4906118344041638152}",
            "httpPrepared": {
              "__timestamp_micros_since_unix_epoch__": "4906118344041638152n",
            },
            "kind": "timestamp",
            "procedureEncoded": {
              "tag": "ok",
              "value": {
                "__timestamp_micros_since_unix_epoch__": "4906118344041638152n",
              },
            },
            "wireEncoded": {
              "__timestamp_micros_since_unix_epoch__": "4906118344041638152n",
            },
          },
          {
            "hostEncoded": 36,
            "httpBody": "36",
            "httpPrepared": 36,
            "kind": "u8",
            "procedureEncoded": {
              "tag": "ok",
              "value": 36,
            },
            "wireEncoded": 36,
          },
          {
            "hostEncoded": 25393,
            "httpBody": "25393",
            "httpPrepared": 25393,
            "kind": "u16",
            "procedureEncoded": {
              "tag": "ok",
              "value": 25393,
            },
            "wireEncoded": 25393,
          },
          {
            "hostEncoded": 3653765314,
            "httpBody": "3653765314",
            "httpPrepared": 3653765314,
            "kind": "u32",
            "procedureEncoded": {
              "tag": "ok",
              "value": 3653765314,
            },
            "wireEncoded": 3653765314,
          },
          {
            "hostEncoded": "18446744073709551614n",
            "httpBody": "18446744073709551614",
            "httpPrepared": "18446744073709551614n",
            "kind": "u64",
            "procedureEncoded": {
              "tag": "ok",
              "value": "18446744073709551614n",
            },
            "wireEncoded": "18446744073709551614n",
          },
          {
            "hostEncoded": "340282366920938463463374607431768211445n",
            "httpBody": "340282366920938463463374607431768211445",
            "httpPrepared": "340282366920938463463374607431768211445n",
            "kind": "u128",
            "procedureEncoded": {
              "tag": "ok",
              "value": "340282366920938463463374607431768211445n",
            },
            "wireEncoded": "340282366920938463463374607431768211445n",
          },
          {
            "hostEncoded": "115792089237316195423570985008687907853269984665640564039457584007913129639914n",
            "httpBody": "115792089237316195423570985008687907853269984665640564039457584007913129639914",
            "httpPrepared": "115792089237316195423570985008687907853269984665640564039457584007913129639914n",
            "kind": "u256",
            "procedureEncoded": {
              "tag": "ok",
              "value": "115792089237316195423570985008687907853269984665640564039457584007913129639914n",
            },
            "wireEncoded": "115792089237316195423570985008687907853269984665640564039457584007913129639914n",
          },
          {
            "hostEncoded": undefined,
            "httpBody": "[]",
            "httpPrepared": undefined,
            "kind": "unit",
            "procedureEncoded": {
              "tag": "ok",
            },
            "wireEncoded": undefined,
          },
          {
            "hostEncoded": {
              "__uuid__": "267945572564789096965692657590739175139n",
            },
            "httpBody": "{"__uuid__":267945572564789096965692657590739175139}",
            "httpPrepared": {
              "__uuid__": "267945572564789096965692657590739175139n",
            },
            "kind": "uuid",
            "procedureEncoded": {
              "tag": "ok",
              "value": {
                "__uuid__": "267945572564789096965692657590739175139n",
              },
            },
            "wireEncoded": {
              "__uuid__": "267945572564789096965692657590739175139n",
            },
          },
        ]
      `)
    }),
  )

  it.effect("pins handwritten envelope quirks across codecs", () =>
    Effect.gen(function* () {
      const UnitResult = T.result(T.unit(), T.string())
      const Sum = T.sum({
        fooBar: T.string(),
        unitCase: T.unit(),
      })
      const AliasCollisionSum = T.sum({
        fooBar: T.string(),
        FooBar: T.string(),
      })
      const OptionString = T.option(T.string())
      const ProcedureUnit = StdbTesting.procedureEnvelope(
        T.unit(),
        ExampleErrors,
      )
      const ProcedureString = StdbTesting.procedureEnvelope(
        T.string(),
        ExampleErrors,
      )

      const typeWireUnitResultMissingValue = yield* Schema.decodeUnknownEffect(
        UnitResult.schema,
      )({
        tag: "ok",
      })
      const typeWireUnitResultArrayPayload = yield* Schema.decodeUnknownEffect(
        UnitResult.schema,
      )({
        tag: "ok",
        value: [],
      })
      const typeWirePascalCaseSumAlias = yield* Schema.decodeUnknownEffect(
        Sum.schema,
      )({
        tag: "FooBar",
        value: "accepted",
      })
      const typeWireLastWinsAliasMap = yield* Schema.decodeUnknownEffect(
        AliasCollisionSum.schema,
      )({
        tag: "FooBar",
        value: "accepted",
      })
      const typeWireNoneObject = yield* Schema.decodeUnknownEffect(
        OptionString.schema,
      )({
        none: {},
      })
      const typeWireNoneTuple = yield* Schema.decodeUnknownEffect(
        OptionString.schema,
      )({
        none: [],
      })
      const httpRouteTupleSum =
        yield* StdbTesting.ClientValueCodec.httpJson.decodeOutput(
          Sum,
          '[0,"accepted"]',
        )
      const httpRouteTupleResult =
        yield* StdbTesting.ClientValueCodec.httpJson.decodeOutput(
          UnitResult,
          "[0,[]]",
        )
      const httpNonePayload =
        yield* StdbTesting.ClientValueCodec.httpJson.decodeOutput(
          OptionString,
          '{"none":{}}',
        )
      const callableUnitOkMissingValue = yield* Schema.decodeUnknownEffect(
        ProcedureUnit.schema,
      )({
        tag: "ok",
      })
      const callableUnitOkUndefinedValue = yield* Schema.decodeUnknownEffect(
        ProcedureUnit.schema,
      )({
        tag: "ok",
        value: undefined,
      })
      const callableRouteTupleStringOk =
        yield* StdbTesting.ClientValueCodec.httpJson.decodeOutput(
          ProcedureString,
          '[0,"accepted"]',
        )

      const snapshots = {
        hostCodec: {
          unitResultMissingValue: stableValue(
            decodeHostValue(UnitResult, { ok: {} }),
          ),
          pascalCaseSumAlias: stableValue(
            decodeHostValue(Sum, { tag: "FooBar", value: "accepted" }),
          ),
          generatedClientPascalCase: stableValue(
            encodeGeneratedClientValue(Sum, Sum.make.fooBar("accepted")),
          ),
        },
        typeWireSchema: {
          unitResultMissingValue: stableValue(typeWireUnitResultMissingValue),
          unitResultArrayPayload: stableValue(typeWireUnitResultArrayPayload),
          pascalCaseSumAlias: stableValue(typeWirePascalCaseSumAlias),
          lastWinsAliasMap: stableValue(typeWireLastWinsAliasMap),
          noneObject: stableValue(typeWireNoneObject),
          noneTuple: stableValue(typeWireNoneTuple),
        },
        httpJson: {
          preparedRouteTupleInput: stableValue(
            StdbTesting.ClientHttpJson.prepareHttpInputValue(Sum, {
              fooBar: "accepted",
            }),
          ),
          routeTupleSum: stableValue(httpRouteTupleSum),
          routeTupleResult: stableValue(httpRouteTupleResult),
          nonePayload: stableValue(httpNonePayload),
        },
        callableProtocol: {
          unitOkMissingValue: stableValue(callableUnitOkMissingValue),
          unitOkUndefinedValue: stableValue(callableUnitOkUndefinedValue),
          routeTupleStringOk: stableValue(callableRouteTupleStringOk),
        },
      }

      expect(snapshots).toMatchInlineSnapshot(`
        {
          "callableProtocol": {
            "routeTupleStringOk": {
              "tag": "ok",
              "value": "accepted",
            },
            "unitOkMissingValue": {
              "tag": "ok",
            },
            "unitOkUndefinedValue": {
              "tag": "ok",
            },
          },
          "hostCodec": {
            "generatedClientPascalCase": {
              "tag": "FooBar",
              "value": "accepted",
            },
            "pascalCaseSumAlias": {
              "tag": "fooBar",
              "value": "accepted",
            },
            "unitResultMissingValue": {
              "ok": undefined,
            },
          },
          "httpJson": {
            "nonePayload": undefined,
            "preparedRouteTupleInput": {
              "fooBar": "accepted",
            },
            "routeTupleResult": {
              "ok": undefined,
            },
            "routeTupleSum": {
              "tag": "fooBar",
              "value": "accepted",
            },
          },
          "typeWireSchema": {
            "lastWinsAliasMap": {
              "tag": "FooBar",
              "value": "accepted",
            },
            "noneObject": undefined,
            "noneTuple": undefined,
            "pascalCaseSumAlias": {
              "tag": "fooBar",
              "value": "accepted",
            },
            "unitResultArrayPayload": {
              "ok": undefined,
            },
            "unitResultMissingValue": {
              "ok": undefined,
            },
          },
        }
      `)
    }),
  )

  it.effect("pins malformed envelope failure identity", () =>
    Effect.gen(function* () {
      const UnitResult = T.result(T.unit(), T.string())
      const Sum = T.sum({
        active: T.string(),
        deleted: T.unit(),
      })
      const OptionString = T.option(T.string())
      const ProcedureString = StdbTesting.procedureEnvelope(
        T.string(),
        ExampleErrors,
      )
      const ProcedureUnit = StdbTesting.procedureEnvelope(
        T.unit(),
        ExampleErrors,
      )

      const hostEncodeMissingSumValue = yield* syncExit(() =>
        StdbTesting.encodeHostValue(Sum, { tag: "active" }),
      )
      const hostDecodeBadNonePayload = yield* syncExit(() =>
        decodeHostValue(OptionString, { none: { extra: true } }),
      )
      const typeWireResultMissingValue = yield* Effect.exit(
        Schema.decodeUnknownEffect(UnitResult.schema)({
          tag: "err",
        }),
      )
      const typeWireSumExtraField = yield* Effect.exit(
        Schema.decodeUnknownEffect(Sum.schema)({
          tag: "active",
          value: "accepted",
          extra: true,
        }),
      )
      const typeWireBadNonePayload = yield* Effect.exit(
        Schema.decodeUnknownEffect(OptionString.schema)({
          none: { extra: true },
        }),
      )
      const httpOutputResultMissingValue = yield* Effect.exit(
        StdbTesting.ClientValueCodec.httpJson.decodeOutput(
          UnitResult,
          '{"tag":"err"}',
        ),
      )
      const httpOutputSumExtraField = yield* Effect.exit(
        StdbTesting.ClientValueCodec.httpJson.decodeOutput(
          Sum,
          '{"tag":"active","value":"accepted","extra":true}',
        ),
      )
      const httpInputNonFiniteNumber = yield* syncExit(() =>
        StdbTesting.ClientHttpJson.encodeHttpInput([Number.NaN]),
      )
      const callableMissingOkValue = yield* Effect.exit(
        Schema.decodeUnknownEffect(ProcedureString.schema)({
          tag: "ok",
        }),
      )
      const callableExtraOkField = yield* Effect.exit(
        Schema.decodeUnknownEffect(ProcedureString.schema)({
          tag: "ok",
          value: "accepted",
          extra: true,
        }),
      )
      const callableBadUnitPayload = yield* Effect.exit(
        Schema.decodeUnknownEffect(ProcedureUnit.schema)({
          tag: "ok",
          value: { extra: true },
        }),
      )

      const snapshots = {
        hostCodec: {
          encodeMissingSumValue: exitFailureSnapshot(hostEncodeMissingSumValue),
          decodeBadNonePayload: exitFailureSnapshot(hostDecodeBadNonePayload),
        },
        typeWireSchema: {
          resultMissingValue: exitFailureSnapshot(typeWireResultMissingValue),
          sumExtraField: exitFailureSnapshot(typeWireSumExtraField),
          badNonePayload: exitFailureSnapshot(typeWireBadNonePayload),
        },
        httpJson: {
          outputResultMissingValue: exitFailureSnapshot(
            httpOutputResultMissingValue,
          ),
          outputSumExtraField: exitFailureSnapshot(httpOutputSumExtraField),
          inputNonFiniteNumber: exitFailureSnapshot(httpInputNonFiniteNumber),
        },
        callableProtocol: {
          missingOkValue: exitFailureSnapshot(callableMissingOkValue),
          extraOkField: exitFailureSnapshot(callableExtraOkField),
          badUnitPayload: exitFailureSnapshot(callableBadUnitPayload),
        },
      }

      expect(snapshots).toMatchInlineSnapshot(`
        {
          "callableProtocol": {
            "badUnitPayload": {
              "issue": {
                "_tag": "Encoding",
                "actual": {
                  "value": {
                    "tag": "ok",
                    "value": {
                      "extra": true,
                    },
                  },
                },
                "ast": {
                  "_tag": "Unknown",
                  "annotations": {},
                  "checks": undefined,
                  "context": undefined,
                  "encoding": [
                    {
                      "to": {
                        "_tag": "Unknown",
                        "annotations": undefined,
                        "checks": undefined,
                        "context": undefined,
                        "encoding": undefined,
                        "~effect/Schema": "~effect/Schema",
                      },
                      "transformation": {
                        "_tag": "Transformation",
                        "decode": {
                          "run": [Function],
                        },
                        "encode": {
                          "run": [Function],
                        },
                        "~effect/SchemaTransformation/Transformation": "~effect/SchemaTransformation/Transformation",
                      },
                    },
                  ],
                  "~effect/Schema": "~effect/Schema",
                },
                "issue": {
                  "_tag": "InvalidValue",
                  "actual": {
                    "value": {
                      "tag": "ok",
                      "value": {
                        "extra": true,
                      },
                    },
                  },
                  "annotations": {
                    "message": "Expected procedure result envelope",
                  },
                  "~effect/SchemaIssue/Issue": "~effect/SchemaIssue/Issue",
                },
                "tag": "Encoding",
              },
              "message": "Expected procedure result envelope",
              "tag": "SchemaError",
            },
            "extraOkField": {
              "issue": {
                "_tag": "Encoding",
                "actual": {
                  "value": {
                    "extra": true,
                    "tag": "ok",
                    "value": "accepted",
                  },
                },
                "ast": {
                  "_tag": "Unknown",
                  "annotations": {},
                  "checks": undefined,
                  "context": undefined,
                  "encoding": [
                    {
                      "to": {
                        "_tag": "Unknown",
                        "annotations": undefined,
                        "checks": undefined,
                        "context": undefined,
                        "encoding": undefined,
                        "~effect/Schema": "~effect/Schema",
                      },
                      "transformation": {
                        "_tag": "Transformation",
                        "decode": {
                          "run": [Function],
                        },
                        "encode": {
                          "run": [Function],
                        },
                        "~effect/SchemaTransformation/Transformation": "~effect/SchemaTransformation/Transformation",
                      },
                    },
                  ],
                  "~effect/Schema": "~effect/Schema",
                },
                "issue": {
                  "_tag": "InvalidValue",
                  "actual": {
                    "value": {
                      "extra": true,
                      "tag": "ok",
                      "value": "accepted",
                    },
                  },
                  "annotations": {
                    "message": "Expected procedure result envelope",
                  },
                  "~effect/SchemaIssue/Issue": "~effect/SchemaIssue/Issue",
                },
                "tag": "Encoding",
              },
              "message": "Expected procedure result envelope",
              "tag": "SchemaError",
            },
            "missingOkValue": {
              "issue": {
                "_tag": "Encoding",
                "actual": {
                  "value": {
                    "tag": "ok",
                  },
                },
                "ast": {
                  "_tag": "Unknown",
                  "annotations": {},
                  "checks": undefined,
                  "context": undefined,
                  "encoding": [
                    {
                      "to": {
                        "_tag": "Unknown",
                        "annotations": undefined,
                        "checks": undefined,
                        "context": undefined,
                        "encoding": undefined,
                        "~effect/Schema": "~effect/Schema",
                      },
                      "transformation": {
                        "_tag": "Transformation",
                        "decode": {
                          "run": [Function],
                        },
                        "encode": {
                          "run": [Function],
                        },
                        "~effect/SchemaTransformation/Transformation": "~effect/SchemaTransformation/Transformation",
                      },
                    },
                  ],
                  "~effect/Schema": "~effect/Schema",
                },
                "issue": {
                  "_tag": "InvalidValue",
                  "actual": {
                    "value": {
                      "tag": "ok",
                    },
                  },
                  "annotations": {
                    "message": "Expected procedure result envelope",
                  },
                  "~effect/SchemaIssue/Issue": "~effect/SchemaIssue/Issue",
                },
                "tag": "Encoding",
              },
              "message": "Expected procedure result envelope",
              "tag": "SchemaError",
            },
          },
          "hostCodec": {
            "decodeBadNonePayload": {
              "issue": {
                "_tag": "Encoding",
                "actual": {
                  "value": {
                    "some": {
                      "none": {
                        "extra": true,
                      },
                    },
                  },
                },
                "ast": {
                  "_tag": "Unknown",
                  "annotations": {},
                  "checks": undefined,
                  "context": undefined,
                  "encoding": [
                    {
                      "to": {
                        "_tag": "Unknown",
                        "annotations": undefined,
                        "checks": undefined,
                        "context": undefined,
                        "encoding": undefined,
                        "~effect/Schema": "~effect/Schema",
                      },
                      "transformation": {
                        "_tag": "Transformation",
                        "decode": {
                          "run": [Function],
                        },
                        "encode": {
                          "run": [Function],
                        },
                        "~effect/SchemaTransformation/Transformation": "~effect/SchemaTransformation/Transformation",
                      },
                    },
                  ],
                  "~effect/Schema": "~effect/Schema",
                },
                "issue": {
                  "_tag": "InvalidType",
                  "actual": {
                    "value": {
                      "none": {
                        "extra": true,
                      },
                    },
                  },
                  "ast": {
                    "_tag": "String",
                    "annotations": {},
                    "checks": undefined,
                    "context": undefined,
                    "encoding": undefined,
                    "~effect/Schema": "~effect/Schema",
                  },
                  "~effect/SchemaIssue/Issue": "~effect/SchemaIssue/Issue",
                },
                "tag": "Encoding",
              },
              "message": "Expected string, got {"none":{"extra":true}}",
              "tag": "SchemaError",
            },
            "encodeMissingSumValue": {
              "message": "Missing sum host value for active",
              "tag": "StdbHostEncodeError",
            },
          },
          "httpJson": {
            "inputNonFiniteNumber": {
              "message": "Cannot encode non-finite number over HTTP JSON",
              "tag": "Error",
            },
            "outputResultMissingValue": {
              "cause": {
                "issue": {
                  "_tag": "Encoding",
                  "actual": {
                    "value": {
                      "tag": "err",
                    },
                  },
                  "ast": {
                    "_tag": "Unknown",
                    "annotations": {},
                    "checks": undefined,
                    "context": undefined,
                    "encoding": [
                      {
                        "to": {
                          "_tag": "Unknown",
                          "annotations": undefined,
                          "checks": undefined,
                          "context": undefined,
                          "encoding": undefined,
                          "~effect/Schema": "~effect/Schema",
                        },
                        "transformation": {
                          "_tag": "Transformation",
                          "decode": {
                            "run": [Function],
                          },
                          "encode": {
                            "run": [Function],
                          },
                          "~effect/SchemaTransformation/Transformation": "~effect/SchemaTransformation/Transformation",
                        },
                      },
                    ],
                    "~effect/Schema": "~effect/Schema",
                  },
                  "issue": {
                    "_tag": "InvalidValue",
                    "actual": {
                      "value": {
                        "tag": "err",
                      },
                    },
                    "annotations": undefined,
                    "~effect/SchemaIssue/Issue": "~effect/SchemaIssue/Issue",
                  },
                  "tag": "Encoding",
                },
                "message": "Invalid data {"tag":"err"}",
                "tag": "SchemaError",
              },
              "message": "SpaceTimeDB decode failed during ok: Invalid data {"tag":"err"}",
              "tag": "StdbDecodeError",
            },
            "outputSumExtraField": {
              "cause": {
                "issue": {
                  "_tag": "Encoding",
                  "actual": {
                    "value": {
                      "extra": true,
                      "tag": "active",
                      "value": "accepted",
                    },
                  },
                  "ast": {
                    "_tag": "Unknown",
                    "annotations": {},
                    "checks": undefined,
                    "context": undefined,
                    "encoding": [
                      {
                        "to": {
                          "_tag": "Unknown",
                          "annotations": undefined,
                          "checks": undefined,
                          "context": undefined,
                          "encoding": undefined,
                          "~effect/Schema": "~effect/Schema",
                        },
                        "transformation": {
                          "_tag": "Transformation",
                          "decode": {
                            "run": [Function],
                          },
                          "encode": {
                            "run": [Function],
                          },
                          "~effect/SchemaTransformation/Transformation": "~effect/SchemaTransformation/Transformation",
                        },
                      },
                    ],
                    "~effect/Schema": "~effect/Schema",
                  },
                  "issue": {
                    "_tag": "InvalidValue",
                    "actual": {
                      "value": {
                        "extra": true,
                        "tag": "active",
                        "value": "accepted",
                      },
                    },
                    "annotations": undefined,
                    "~effect/SchemaIssue/Issue": "~effect/SchemaIssue/Issue",
                  },
                  "tag": "Encoding",
                },
                "message": "Invalid data {"tag":"active","value":"accepted","extra":true}",
                "tag": "SchemaError",
              },
              "message": "SpaceTimeDB decode failed during ok: Invalid data {"tag":"active","value":"accepted","extra":true}",
              "tag": "StdbDecodeError",
            },
          },
          "typeWireSchema": {
            "badNonePayload": {
              "issue": {
                "_tag": "Encoding",
                "actual": {
                  "value": {
                    "none": {
                      "extra": true,
                    },
                  },
                },
                "ast": {
                  "_tag": "Unknown",
                  "annotations": {},
                  "checks": undefined,
                  "context": undefined,
                  "encoding": [
                    {
                      "to": {
                        "_tag": "Unknown",
                        "annotations": undefined,
                        "checks": undefined,
                        "context": undefined,
                        "encoding": undefined,
                        "~effect/Schema": "~effect/Schema",
                      },
                      "transformation": {
                        "_tag": "Transformation",
                        "decode": {
                          "run": [Function],
                        },
                        "encode": {
                          "run": [Function],
                        },
                        "~effect/SchemaTransformation/Transformation": "~effect/SchemaTransformation/Transformation",
                      },
                    },
                  ],
                  "~effect/Schema": "~effect/Schema",
                },
                "issue": {
                  "_tag": "InvalidValue",
                  "actual": {
                    "value": {
                      "none": {
                        "extra": true,
                      },
                    },
                  },
                  "annotations": undefined,
                  "~effect/SchemaIssue/Issue": "~effect/SchemaIssue/Issue",
                },
                "tag": "Encoding",
              },
              "message": "Invalid data {"none":{"extra":true}}",
              "tag": "SchemaError",
            },
            "resultMissingValue": {
              "issue": {
                "_tag": "Encoding",
                "actual": {
                  "value": {
                    "tag": "err",
                  },
                },
                "ast": {
                  "_tag": "Unknown",
                  "annotations": {},
                  "checks": undefined,
                  "context": undefined,
                  "encoding": [
                    {
                      "to": {
                        "_tag": "Unknown",
                        "annotations": undefined,
                        "checks": undefined,
                        "context": undefined,
                        "encoding": undefined,
                        "~effect/Schema": "~effect/Schema",
                      },
                      "transformation": {
                        "_tag": "Transformation",
                        "decode": {
                          "run": [Function],
                        },
                        "encode": {
                          "run": [Function],
                        },
                        "~effect/SchemaTransformation/Transformation": "~effect/SchemaTransformation/Transformation",
                      },
                    },
                  ],
                  "~effect/Schema": "~effect/Schema",
                },
                "issue": {
                  "_tag": "InvalidValue",
                  "actual": {
                    "value": {
                      "tag": "err",
                    },
                  },
                  "annotations": undefined,
                  "~effect/SchemaIssue/Issue": "~effect/SchemaIssue/Issue",
                },
                "tag": "Encoding",
              },
              "message": "Invalid data {"tag":"err"}",
              "tag": "SchemaError",
            },
            "sumExtraField": {
              "issue": {
                "_tag": "Encoding",
                "actual": {
                  "value": {
                    "extra": true,
                    "tag": "active",
                    "value": "accepted",
                  },
                },
                "ast": {
                  "_tag": "Unknown",
                  "annotations": {},
                  "checks": undefined,
                  "context": undefined,
                  "encoding": [
                    {
                      "to": {
                        "_tag": "Unknown",
                        "annotations": undefined,
                        "checks": undefined,
                        "context": undefined,
                        "encoding": undefined,
                        "~effect/Schema": "~effect/Schema",
                      },
                      "transformation": {
                        "_tag": "Transformation",
                        "decode": {
                          "run": [Function],
                        },
                        "encode": {
                          "run": [Function],
                        },
                        "~effect/SchemaTransformation/Transformation": "~effect/SchemaTransformation/Transformation",
                      },
                    },
                  ],
                  "~effect/Schema": "~effect/Schema",
                },
                "issue": {
                  "_tag": "InvalidValue",
                  "actual": {
                    "value": {
                      "extra": true,
                      "tag": "active",
                      "value": "accepted",
                    },
                  },
                  "annotations": undefined,
                  "~effect/SchemaIssue/Issue": "~effect/SchemaIssue/Issue",
                },
                "tag": "Encoding",
              },
              "message": "Invalid data {"tag":"active","value":"accepted","extra":true}",
              "tag": "SchemaError",
            },
          },
        }
      `)
    }),
  )
})
