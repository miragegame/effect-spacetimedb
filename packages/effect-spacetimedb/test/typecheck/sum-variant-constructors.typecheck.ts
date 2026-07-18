import * as Schema from "effect/Schema"
import * as Stdb from "effect-spacetimedb"
import { transform } from "../helpers/schema-transform"
import type { Assert, IsEqual } from "./helpers"

const TurnEventContent = Stdb.sum({
  Prose: Stdb.struct({
    text: Stdb.string(),
  }),
  Score: Stdb.struct({
    delta: Stdb.i32(),
  }),
  Done: Stdb.unit(),
})

const prose = TurnEventContent.make.Prose({ text: "hello" })
const score = TurnEventContent.make.Score({ delta: 1 })
const done = TurnEventContent.make.Done
const namedProse = TurnEventContent.name("turn_event_content").make.Prose({
  text: "hello",
})
const optionalDone = TurnEventContent.optional().make.Done

type ProseContent = Extract<
  Stdb.TypeOf<typeof TurnEventContent>,
  { readonly tag: "Prose" }
>
type ScoreContent = Extract<
  Stdb.TypeOf<typeof TurnEventContent>,
  { readonly tag: "Score" }
>
type DoneContent = Extract<
  Stdb.TypeOf<typeof TurnEventContent>,
  { readonly tag: "Done" }
>

type _ProseContent = Assert<IsEqual<typeof prose, ProseContent>>
type _ScoreContent = Assert<IsEqual<typeof score, ScoreContent>>
type _DoneContent = Assert<IsEqual<typeof done, DoneContent>>
type _NamedProseContent = Assert<IsEqual<typeof namedProse, ProseContent>>
type _OptionalDoneContent = Assert<IsEqual<typeof optionalDone, DoneContent>>

// @ts-expect-error payload variants require a payload argument
TurnEventContent.make.Prose()

// @ts-expect-error payload must match the selected variant
TurnEventContent.make.Prose({ text: 1 })

// @ts-expect-error constructor tags are limited to declared variants
TurnEventContent.make.Missing({ text: "hello" })

// @ts-expect-error unit variants are values, not functions
TurnEventContent.make.Done()

const CollisionNames = Stdb.sum({
  default: Stdb.struct({
    value: Stdb.u32(),
  }),
  name: Stdb.unit(),
})
const defaultContent = CollisionNames.make.default({ value: 1 })
const nameContent = CollisionNames.make.name

type _DefaultContent = Assert<
  IsEqual<
    typeof defaultContent,
    Extract<Stdb.TypeOf<typeof CollisionNames>, { readonly tag: "default" }>
  >
>
type _NameContent = Assert<
  IsEqual<
    typeof nameContent,
    Extract<Stdb.TypeOf<typeof CollisionNames>, { readonly tag: "name" }>
  >
>

const Phase = Stdb.enum("Lobby", "Running")
const lobby = Phase.make.Lobby
const namedLobby = Phase.name("phase").make.Lobby

type _LobbyContent = Assert<
  IsEqual<
    typeof lobby,
    Extract<Stdb.TypeOf<typeof Phase>, { readonly tag: "Lobby" }>
  >
>
type _NamedLobbyContent = Assert<IsEqual<typeof namedLobby, typeof lobby>>

// @ts-expect-error enum constructors are limited to declared tags
Phase.make.Missing

const UnitLoweredLiteral = Stdb.custom(
  transform(Schema.Void, Schema.Literal("done"), {
    decode: () => "done" as const,
    encode: () => undefined,
  }),
  { type: Stdb.unit() },
)
const UnitLoweredSum = Stdb.sum({
  Done: UnitLoweredLiteral,
})
const unitLoweredDone = UnitLoweredSum.make.Done("done")

type _UnitLoweredDone = Assert<
  IsEqual<
    typeof unitLoweredDone,
    Extract<Stdb.TypeOf<typeof UnitLoweredSum>, { readonly tag: "Done" }>
  >
>

// @ts-expect-error custom unit-lowered payload variants still require their authored payload
UnitLoweredSum.make.Done()

const WireLiteralUnit = Stdb.custom(
  transform(Schema.Literal("done"), Schema.Void, {
    decode: () => undefined,
    encode: () => "done" as const,
  }),
  { type: Stdb.string() },
)
const WireLiteralUnitSum = Stdb.sum({
  Done: WireLiteralUnit,
})
const wireLiteralUnitDone = WireLiteralUnitSum.make.Done

type _WireLiteralUnitDone = Assert<
  IsEqual<
    typeof wireLiteralUnitDone,
    Extract<Stdb.TypeOf<typeof WireLiteralUnitSum>, { readonly tag: "Done" }>
  >
>

// @ts-expect-error authored unit custom variants are values, not functions
WireLiteralUnitSum.make.Done()

const Result = Stdb.result(Stdb.string(), Stdb.string())

// @ts-expect-error result envelopes intentionally do not expose generic sum constructors
Result.make
