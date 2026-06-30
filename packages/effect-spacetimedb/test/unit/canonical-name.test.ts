import * as EffectVitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as StdbTesting from "effect-spacetimedb/testing"
import { TestLayer } from "../helpers/test-layer"

const { expect } = EffectVitest
const describe = EffectVitest.layer(TestLayer)

const {
  camelCaseName,
  isCamelCaseCanonical,
  pascalCaseName,
  snakeCaseName,
  splitWords,
} = StdbTesting.ContractCanonicalName

describe("canonical name mirror", (it) => {
  it.effect("matches native convert_case vectors for ASCII identifiers", () =>
    Effect.gen(function* () {
      const vectors = [
        ["", "", "", ""],
        ["FruitBasket", "fruit_basket", "fruitBasket", "FruitBasket"],
        ["basketId", "basket_id", "basketId", "BasketId"],
        ["ItemCount", "item_count", "itemCount", "ItemCount"],
        ["color_label", "color_label", "colorLabel", "ColorLabel"],
        ["space case", "space_case", "spaceCase", "SpaceCase"],
        ["kebab-case", "kebab_case", "kebabCase", "KebabCase"],
        ["recordId", "record_id", "recordId", "RecordId"],
        ["ScheduledAt", "scheduled_at", "scheduledAt", "ScheduledAt"],
        ["SeqId", "seq_id", "seqId", "SeqId"],
        ["doDelivery", "do_delivery", "doDelivery", "DoDelivery"],
        ["ProcessItem", "process_item", "processItem", "ProcessItem"],
        ["azB", "az_b", "azB", "AzB"],
        ["aZb", "a_zb", "aZb", "AZb"],
        ["a/B", "a/b", "a/b", "A/b"],
        ["a:b", "a:b", "a:b", "A:b"],
        ["a{B", "a{b", "a{b", "A{b"],
        ["Player1Name", "player_1_name", "player1Name", "Player1Name"],
        ["Player0Name", "player_0_name", "player0Name", "Player0Name"],
        ["Player9Name", "player_9_name", "player9Name", "Player9Name"],
        ["CreatePlayer1", "create_player_1", "createPlayer1", "CreatePlayer1"],
        ["CreatePlayer0", "create_player_0", "createPlayer0", "CreatePlayer0"],
        ["CreatePlayer9", "create_player_9", "createPlayer9", "CreatePlayer9"],
        ["HTTPServer", "http_server", "httpServer", "HttpServer"],
        ["userID", "user_id", "userId", "UserId"],
        ["banUntil6", "ban_until_6", "banUntil6", "BanUntil6"],
        ["z9", "z_9", "z9", "Z9"],
        ["Z9", "z_9", "z9", "Z9"],
        ["9z", "9_z", "9Z", "9Z"],
        ["9Z", "9_z", "9Z", "9Z"],
        [
          "matchMarkEndedV2",
          "match_mark_ended_v_2",
          "matchMarkEndedV2",
          "MatchMarkEndedV2",
        ],
        ["a1b", "a_1_b", "a1B", "A1B"],
        ["user", "user", "user", "User"],
        [
          "XMLHttpRequest",
          "xml_http_request",
          "xmlHttpRequest",
          "XmlHttpRequest",
        ],
        ["a__b", "a_b", "aB", "AB"],
        ["AB", "ab", "ab", "Ab"],
      ] as const

      yield* Effect.forEach(
        vectors,
        Effect.fn(function* ([input, snake, camel, pascal]) {
          expect(snakeCaseName(input)).toBe(snake)
          expect(camelCaseName(input)).toBe(camel)
          expect(pascalCaseName(input)).toBe(pascal)
        }),
      )

      expect(splitWords("HTTPServer")).toEqual(["HTTP", "Server"])
      expect(splitWords("XMLHttpRequest")).toEqual(["XML", "Http", "Request"])
      expect(splitWords("a-")).toEqual(["a"])
      expect(splitWords("--")).toEqual([])
    }),
  )

  it.effect("satisfies fixed-point and round-trip properties", () =>
    Effect.gen(function* () {
      const corpus = [
        "user",
        "User",
        "userId",
        "userID",
        "HTTPServer",
        "XMLHttpRequest",
        "banUntil6",
        "Player1Name",
        "CreatePlayer1",
        "a1b",
        "A1B",
        "a__b",
        "snake_case",
        "kebab-case",
        "space case",
        "AB",
        "ABCDef2Ghi3j",
      ]

      yield* Effect.forEach(
        corpus,
        Effect.fn(function* (input) {
          expect(snakeCaseName(snakeCaseName(input))).toBe(snakeCaseName(input))
          expect(camelCaseName(snakeCaseName(input))).toBe(camelCaseName(input))
          expect(isCamelCaseCanonical(camelCaseName(input))).toBe(true)
          expect(pascalCaseName(`Prefix${snakeCaseName(input)}123`)).toMatch(
            /^Prefix/,
          )
        }),
      )
    }),
  )

  it.effect("accepts only camelCase fixed points", () =>
    Effect.gen(function* () {
      yield* Effect.forEach(
        ["userId", "kvRead", "banUntil6", "user"],
        Effect.fn(function* (accepted) {
          expect(isCamelCaseCanonical(accepted)).toBe(true)
        }),
      )

      yield* Effect.forEach(
        ["userID", "user_id", "UserId", "HTTPServer", "by_user"],
        Effect.fn(function* (rejected) {
          expect(isCamelCaseCanonical(rejected)).toBe(false)
        }),
      )
    }),
  )
})
