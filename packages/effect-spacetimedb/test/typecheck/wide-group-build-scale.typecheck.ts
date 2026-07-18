import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Stdb from "effect-spacetimedb"
import { build } from "effect-spacetimedb/server-compiler"

const WideText = Stdb.string(Schema.String)
const WideParams = Stdb.struct({ value: WideText })

const reducer = <const Name extends string>(name: Name) =>
  Stdb.StdbFn.reducer(name, { params: WideParams })

// Exercises a single wide group at 59 endpoints — the widest per-group handler
// record this fixture pins the type-instantiation budget against.
const wideReducers = [
  reducer("auth_width_00"),
  reducer("auth_width_01"),
  reducer("auth_width_02"),
  reducer("auth_width_03"),
  reducer("auth_width_04"),
  reducer("auth_width_05"),
  reducer("auth_width_06"),
  reducer("auth_width_07"),
  reducer("auth_width_08"),
  reducer("auth_width_09"),
  reducer("auth_width_10"),
  reducer("auth_width_11"),
  reducer("auth_width_12"),
  reducer("auth_width_13"),
  reducer("auth_width_14"),
  reducer("auth_width_15"),
  reducer("auth_width_16"),
  reducer("auth_width_17"),
  reducer("auth_width_18"),
  reducer("auth_width_19"),
  reducer("auth_width_20"),
  reducer("auth_width_21"),
  reducer("auth_width_22"),
  reducer("auth_width_23"),
  reducer("auth_width_24"),
  reducer("auth_width_25"),
  reducer("auth_width_26"),
  reducer("auth_width_27"),
  reducer("auth_width_28"),
  reducer("auth_width_29"),
  reducer("auth_width_30"),
  reducer("auth_width_31"),
  reducer("auth_width_32"),
  reducer("auth_width_33"),
  reducer("auth_width_34"),
  reducer("auth_width_35"),
  reducer("auth_width_36"),
  reducer("auth_width_37"),
  reducer("auth_width_38"),
  reducer("auth_width_39"),
  reducer("auth_width_40"),
  reducer("auth_width_41"),
  reducer("auth_width_42"),
  reducer("auth_width_43"),
  reducer("auth_width_44"),
  reducer("auth_width_45"),
  reducer("auth_width_46"),
  reducer("auth_width_47"),
  reducer("auth_width_48"),
  reducer("auth_width_49"),
  reducer("auth_width_50"),
  reducer("auth_width_51"),
  reducer("auth_width_52"),
  reducer("auth_width_53"),
  reducer("auth_width_54"),
  reducer("auth_width_55"),
  reducer("auth_width_56"),
  reducer("auth_width_57"),
  reducer("auth_width_58"),
] as const

const WideGroup = Stdb.StdbGroup.make("ObservedWidth").add(...wideReducers)

const WideModule = Stdb.StdbModule.make("wide_group_build_scale", {}).add(
  WideGroup,
)

const handler = () => Effect.void

const WideHandlers: Stdb.GroupCheckedHandlers<
  typeof WideModule,
  "ObservedWidth"
> = {
  auth_width_00: handler,
  auth_width_01: handler,
  auth_width_02: handler,
  auth_width_03: handler,
  auth_width_04: handler,
  auth_width_05: handler,
  auth_width_06: handler,
  auth_width_07: handler,
  auth_width_08: handler,
  auth_width_09: handler,
  auth_width_10: handler,
  auth_width_11: handler,
  auth_width_12: handler,
  auth_width_13: handler,
  auth_width_14: handler,
  auth_width_15: handler,
  auth_width_16: handler,
  auth_width_17: handler,
  auth_width_18: handler,
  auth_width_19: handler,
  auth_width_20: handler,
  auth_width_21: handler,
  auth_width_22: handler,
  auth_width_23: handler,
  auth_width_24: handler,
  auth_width_25: handler,
  auth_width_26: handler,
  auth_width_27: handler,
  auth_width_28: handler,
  auth_width_29: handler,
  auth_width_30: handler,
  auth_width_31: handler,
  auth_width_32: handler,
  auth_width_33: handler,
  auth_width_34: handler,
  auth_width_35: handler,
  auth_width_36: handler,
  auth_width_37: handler,
  auth_width_38: handler,
  auth_width_39: handler,
  auth_width_40: handler,
  auth_width_41: handler,
  auth_width_42: handler,
  auth_width_43: handler,
  auth_width_44: handler,
  auth_width_45: handler,
  auth_width_46: handler,
  auth_width_47: handler,
  auth_width_48: handler,
  auth_width_49: handler,
  auth_width_50: handler,
  auth_width_51: handler,
  auth_width_52: handler,
  auth_width_53: handler,
  auth_width_54: handler,
  auth_width_55: handler,
  auth_width_56: handler,
  auth_width_57: handler,
  auth_width_58: handler,
}

const WideLive = Stdb.StdbBuilder.groupPrechecked(WideModule, "ObservedWidth", {
  ...WideHandlers,
})

void build(WideModule, [WideLive] as const)
