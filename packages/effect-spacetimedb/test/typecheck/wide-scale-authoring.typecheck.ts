import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Stdb from "effect-spacetimedb"
import type { AnyGroup } from "../../src/builder/declarations.ts"
import type { SchedulePairsOf } from "../../src/builder/type-utils.ts"
import type { Assert, Expand, IsAssignable, IsEqual } from "./helpers"

const ScaleText = Stdb.string(Schema.String)
const ScaleParams = Stdb.struct({ value: ScaleText })

const scaleName = <const Prefix extends string, const Suffix extends string>(
  prefix: Prefix,
  suffix: Suffix,
): `${Prefix}_${Suffix}` => `${prefix}_${suffix}`

const reducer = <const Name extends string>(name: Name) =>
  Stdb.StdbFn.reducer(name, { params: ScaleParams })

const procedure = <const Name extends string>(name: Name) =>
  Stdb.StdbFn.procedure(name, {
    params: ScaleParams,
    returns: ScaleText,
  })

const group42 = <const Id extends string, const Prefix extends string>(
  id: Id,
  prefix: Prefix,
) =>
  Stdb.StdbGroup.make(id).add(
    reducer(scaleName(prefix, "00")),
    reducer(scaleName(prefix, "01")),
    reducer(scaleName(prefix, "02")),
    reducer(scaleName(prefix, "03")),
    reducer(scaleName(prefix, "04")),
    reducer(scaleName(prefix, "05")),
    reducer(scaleName(prefix, "06")),
    reducer(scaleName(prefix, "07")),
    reducer(scaleName(prefix, "08")),
    reducer(scaleName(prefix, "09")),
    reducer(scaleName(prefix, "10")),
    reducer(scaleName(prefix, "11")),
    reducer(scaleName(prefix, "12")),
    reducer(scaleName(prefix, "13")),
    reducer(scaleName(prefix, "14")),
    reducer(scaleName(prefix, "15")),
    reducer(scaleName(prefix, "16")),
    reducer(scaleName(prefix, "17")),
    reducer(scaleName(prefix, "18")),
    reducer(scaleName(prefix, "19")),
    reducer(scaleName(prefix, "20")),
    reducer(scaleName(prefix, "21")),
    reducer(scaleName(prefix, "22")),
    reducer(scaleName(prefix, "23")),
    reducer(scaleName(prefix, "24")),
    reducer(scaleName(prefix, "25")),
    reducer(scaleName(prefix, "26")),
    reducer(scaleName(prefix, "27")),
    reducer(scaleName(prefix, "28")),
    reducer(scaleName(prefix, "29")),
    reducer(scaleName(prefix, "30")),
    reducer(scaleName(prefix, "31")),
    reducer(scaleName(prefix, "32")),
    reducer(scaleName(prefix, "33")),
    reducer(scaleName(prefix, "34")),
    reducer(scaleName(prefix, "35")),
    reducer(scaleName(prefix, "36")),
    reducer(scaleName(prefix, "37")),
    reducer(scaleName(prefix, "38")),
    reducer(scaleName(prefix, "39")),
    reducer(scaleName(prefix, "40")),
    reducer(scaleName(prefix, "41")),
  )

const WideScaleGroup00 = group42("WideScaleGroup00", "scale00")
const WideScaleGroup01 = group42("WideScaleGroup01", "scale01")
const WideScaleGroup02 = group42("WideScaleGroup02", "scale02")
const WideScaleGroup03 = group42("WideScaleGroup03", "scale03")
const WideScaleGroup04 = group42("WideScaleGroup04", "scale04")
const WideScaleGroup05 = group42("WideScaleGroup05", "scale05")
const WideScaleGroup06 = group42("WideScaleGroup06", "scale06")
const WideScaleGroup07 = group42("WideScaleGroup07", "scale07")
const WideScaleGroup08 = group42("WideScaleGroup08", "scale08")
const WideScaleGroup09 = group42("WideScaleGroup09", "scale09")
const WideScaleGroup10 = group42("WideScaleGroup10", "scale10")
const WideScaleGroup11 = group42("WideScaleGroup11", "scale11")
const WideScaleGroup12 = group42("WideScaleGroup12", "scale12")
const WideScaleGroup13 = group42("WideScaleGroup13", "scale13")
const WideScaleGroup14 = group42("WideScaleGroup14", "scale14")
const WideScaleGroup15 = group42("WideScaleGroup15", "scale15")
const WideScaleGroup16 = group42("WideScaleGroup16", "scale16")
const WideScaleGroup17 = group42("WideScaleGroup17", "scale17")
const WideScaleGroup18 = group42("WideScaleGroup18", "scale18")

const ScaleScheduledA = Stdb.scheduledTable("scaleScheduledA", {
  columns: {
    note: ScaleText,
  },
})

const ScaleScheduledB = Stdb.scheduledTable("scaleScheduledB", {
  columns: {
    note: ScaleText,
  },
})

const WideScaleScheduled = Stdb.StdbGroup.make("WideScaleScheduled").add(
  Stdb.StdbFn.scheduledReducer("scaleScheduledReducer", {
    table: ScaleScheduledA,
  }),
  Stdb.StdbFn.scheduledProcedure("scaleScheduledProcedure", {
    table: ScaleScheduledB,
  }),
)

const MixedSectionGroup = Stdb.StdbGroup.make("MixedSection").add(
  reducer("mixedReducer"),
  procedure("mixedProcedure"),
  Stdb.StdbFn.anonymousView("mixedView", { returns: ScaleText }),
)

const WideScaleModule = Stdb.StdbModule.make("wide_scale_probe", {})
  .addTables(ScaleScheduledA, ScaleScheduledB)
  .add(
    WideScaleGroup00,
    WideScaleGroup01,
    WideScaleGroup02,
    WideScaleGroup03,
    WideScaleGroup04,
    WideScaleGroup05,
    WideScaleGroup06,
    WideScaleGroup07,
    WideScaleGroup08,
    WideScaleGroup09,
    WideScaleGroup10,
    WideScaleGroup11,
    WideScaleGroup12,
    WideScaleGroup13,
    WideScaleGroup14,
    WideScaleGroup15,
    WideScaleGroup16,
    WideScaleGroup17,
    WideScaleGroup18,
    WideScaleScheduled,
    MixedSectionGroup,
  )

const ModuleChainArm = Stdb.StdbModule.make("wide_scale_chain_probe", {})
  .addTables(ScaleScheduledA, ScaleScheduledB)
  .add(WideScaleGroup00)
  .add(WideScaleGroup01)
  .add(WideScaleGroup02)
  .add(WideScaleGroup03)
  .add(WideScaleGroup04)
  .add(WideScaleGroup05)
  .add(WideScaleGroup06)
  .add(WideScaleGroup07)
  .add(WideScaleGroup08)
  .add(WideScaleGroup09)
  .add(WideScaleGroup10)
  .add(WideScaleGroup11)
  .add(WideScaleGroup12)
  .add(WideScaleGroup13)
  .add(WideScaleGroup14)
  .add(WideScaleGroup15)
  .add(WideScaleGroup16)
  .add(WideScaleGroup17)
  .add(WideScaleGroup18)
  .add(WideScaleScheduled)
  .add(MixedSectionGroup)

const ChainedSingleAddGroup = Stdb.StdbGroup.make("ChainedSingleAdd")
  .add(reducer(scaleName("chained", "00")))
  .add(reducer(scaleName("chained", "01")))
  .add(reducer(scaleName("chained", "02")))
  .add(reducer(scaleName("chained", "03")))
  .add(reducer(scaleName("chained", "04")))
  .add(reducer(scaleName("chained", "05")))
  .add(reducer(scaleName("chained", "06")))
  .add(reducer(scaleName("chained", "07")))
  .add(reducer(scaleName("chained", "08")))
  .add(reducer(scaleName("chained", "09")))
  .add(reducer(scaleName("chained", "10")))
  .add(reducer(scaleName("chained", "11")))
  .add(reducer(scaleName("chained", "12")))
  .add(reducer(scaleName("chained", "13")))
  .add(reducer(scaleName("chained", "14")))
  .add(reducer(scaleName("chained", "15")))
  .add(reducer(scaleName("chained", "16")))
  .add(reducer(scaleName("chained", "17")))
  .add(reducer(scaleName("chained", "18")))
  .add(reducer(scaleName("chained", "19")))
  .add(reducer(scaleName("chained", "20")))
  .add(reducer(scaleName("chained", "21")))
  .add(reducer(scaleName("chained", "22")))
  .add(reducer(scaleName("chained", "23")))
  .add(reducer(scaleName("chained", "24")))
  .add(reducer(scaleName("chained", "25")))
  .add(reducer(scaleName("chained", "26")))
  .add(reducer(scaleName("chained", "27")))
  .add(reducer(scaleName("chained", "28")))
  .add(reducer(scaleName("chained", "29")))
  .add(reducer(scaleName("chained", "30")))
  .add(reducer(scaleName("chained", "31")))
  .add(reducer(scaleName("chained", "32")))
  .add(reducer(scaleName("chained", "33")))
  .add(reducer(scaleName("chained", "34")))
  .add(reducer(scaleName("chained", "35")))
  .add(reducer(scaleName("chained", "36")))
  .add(reducer(scaleName("chained", "37")))
  .add(reducer(scaleName("chained", "38")))
  .add(reducer(scaleName("chained", "39")))
  .add(reducer(scaleName("chained", "40")))
  .add(reducer(scaleName("chained", "41")))
  .add(reducer(scaleName("chained", "42")))
  .add(reducer(scaleName("chained", "43")))
  .add(reducer(scaleName("chained", "44")))
  .add(reducer(scaleName("chained", "45")))
  .add(reducer(scaleName("chained", "46")))
  .add(reducer(scaleName("chained", "47")))
  .add(reducer(scaleName("chained", "48")))
  .add(reducer(scaleName("chained", "49")))

const ChainedSingleAddModule = Stdb.StdbModule.make(
  "chained_single_add_probe",
  {},
).add(ChainedSingleAddGroup)

const SharedScaleGroup = Stdb.StdbGroup.make("SharedScale").add(
  reducer("sharedScaleWrite"),
)

const SharedScaleModuleA = Stdb.StdbModule.make("shared_scale_a", {}).add(
  SharedScaleGroup,
)
const SharedScaleModuleB = Stdb.StdbModule.make("shared_scale_b", {}).add(
  SharedScaleGroup,
)

const DualLifecycleGroup = Stdb.StdbGroup.make("DualLifecycle").add(
  Stdb.StdbFn.init(),
)

const DualLifecycleModule = Stdb.StdbModule.make("dual_lifecycle_probe", {
  lifecycle: {
    init: Stdb.StdbFn.init(),
    clientConnected: Stdb.StdbFn.clientConnected(),
  },
}).add(DualLifecycleGroup)

const HttpRequest = Schema.Struct({
  value: Schema.String,
})

const HttpResponse = Schema.Struct({
  ok: Schema.Boolean,
})

const MergedHttpGroup = Stdb.StdbHttpGroup.make("MergedHttp")
  .add(Stdb.StdbHttp.post("rawScaleHttp", "/raw"))
  .merge(
    Stdb.StdbHttpGroup.make("NestedHttp").add(
      Stdb.StdbHttp.post("typedScaleHttp", "/typed", {
        request: HttpRequest,
        response: HttpResponse,
      }),
    ),
  )

const HttpScaleModule = Stdb.StdbModule.make("http_scale_probe", {}).add(
  MergedHttpGroup,
)

const checkedHandler = Effect.fn(function* (args: { readonly value: string }) {
  void args.value
})

const WideScaleGroup09Handlers: Stdb.GroupCheckedHandlers<
  typeof WideScaleModule,
  "WideScaleGroup09"
> = {
  scale09_00: checkedHandler,
  scale09_01: checkedHandler,
  scale09_02: checkedHandler,
  scale09_03: checkedHandler,
  scale09_04: checkedHandler,
  scale09_05: checkedHandler,
  scale09_06: checkedHandler,
  scale09_07: checkedHandler,
  scale09_08: checkedHandler,
  scale09_09: checkedHandler,
  scale09_10: checkedHandler,
  scale09_11: checkedHandler,
  scale09_12: checkedHandler,
  scale09_13: checkedHandler,
  scale09_14: checkedHandler,
  scale09_15: checkedHandler,
  scale09_16: checkedHandler,
  scale09_17: checkedHandler,
  scale09_18: checkedHandler,
  scale09_19: checkedHandler,
  scale09_20: checkedHandler,
  scale09_21: checkedHandler,
  scale09_22: checkedHandler,
  scale09_23: checkedHandler,
  scale09_24: checkedHandler,
  scale09_25: checkedHandler,
  scale09_26: checkedHandler,
  scale09_27: checkedHandler,
  scale09_28: checkedHandler,
  scale09_29: checkedHandler,
  scale09_30: checkedHandler,
  scale09_31: checkedHandler,
  scale09_32: checkedHandler,
  scale09_33: checkedHandler,
  scale09_34: checkedHandler,
  scale09_35: checkedHandler,
  scale09_36: checkedHandler,
  scale09_37: checkedHandler,
  scale09_38: checkedHandler,
  scale09_39: checkedHandler,
  scale09_40: checkedHandler,
  scale09_41: checkedHandler,
}

const ChainedHandlers: Stdb.GroupCheckedHandlers<
  typeof ChainedSingleAddModule,
  "ChainedSingleAdd",
  "chained_49"
> = {
  chained_49: checkedHandler,
}

type WideScaleGroups =
  | typeof WideScaleGroup00
  | typeof WideScaleGroup01
  | typeof WideScaleGroup02
  | typeof WideScaleGroup03
  | typeof WideScaleGroup04
  | typeof WideScaleGroup05
  | typeof WideScaleGroup06
  | typeof WideScaleGroup07
  | typeof WideScaleGroup08
  | typeof WideScaleGroup09
  | typeof WideScaleGroup10
  | typeof WideScaleGroup11
  | typeof WideScaleGroup12
  | typeof WideScaleGroup13
  | typeof WideScaleGroup14
  | typeof WideScaleGroup15
  | typeof WideScaleGroup16
  | typeof WideScaleGroup17
  | typeof WideScaleGroup18
  | typeof WideScaleScheduled

type _SchedulePairsOfGroups = Assert<
  IsEqual<
    SchedulePairsOf<WideScaleGroups>,
    | {
        readonly target: "scaleScheduledReducer"
        readonly table: "scaleScheduledA"
      }
    | {
        readonly target: "scaleScheduledProcedure"
        readonly table: "scaleScheduledB"
      }
  >
>

type WideScaleGroupNames = Stdb.GroupNames<typeof WideScaleModule>
type _WideScaleBoundaryNames = Assert<
  IsEqual<
    Extract<WideScaleGroupNames, "WideScaleGroup00" | "WideScaleGroup18">,
    "WideScaleGroup00" | "WideScaleGroup18"
  >
>

type _ModuleChainBoundaryNames = Assert<
  IsEqual<
    Extract<
      Stdb.GroupNames<typeof ModuleChainArm>,
      "WideScaleGroup00" | "MixedSection"
    >,
    "WideScaleGroup00" | "MixedSection"
  >
>

type _WideScaleTableIndex = Assert<
  IsEqual<
    (typeof WideScaleModule)["spec"]["tables"]["scaleScheduledA"],
    typeof ScaleScheduledA
  >
>

type _WideScaleGroup09HandlersAssignable = Assert<
  IsAssignable<
    typeof WideScaleGroup09Handlers,
    Stdb.GroupCheckedHandlers<typeof WideScaleModule, "WideScaleGroup09">
  >
>

type _ChainedSingleAddBoundary = Assert<
  IsEqual<
    keyof (typeof ChainedSingleAddModule)["spec"]["reducers"] & "chained_49",
    "chained_49"
  >
>

type _SharedGroupModuleA = Assert<
  IsEqual<Stdb.GroupNames<typeof SharedScaleModuleA>, "SharedScale">
>

type _SharedGroupModuleB = Assert<
  IsEqual<Stdb.GroupNames<typeof SharedScaleModuleB>, "SharedScale">
>

type _DualLifecycleKeys = Assert<
  IsEqual<
    keyof (typeof DualLifecycleModule)["spec"]["lifecycle"] & string,
    "init" | "clientConnected"
  >
>

type _MixedProcedureArgs = Assert<
  IsEqual<
    Expand<Stdb.ProcedureArgsFor<typeof WideScaleModule, "mixedProcedure">>,
    { readonly value: string }
  >
>

type _MixedProcedureSuccess = Assert<
  IsEqual<
    Stdb.ProcedureSuccessFor<typeof WideScaleModule, "mixedProcedure">,
    string
  >
>

type _MixedViewSuccess = Assert<
  IsEqual<
    Extract<Stdb.ViewSuccessFor<typeof WideScaleModule, "mixedView">, string>,
    string
  >
>

type _TypedHttpArgs = Assert<
  IsEqual<
    Stdb.HttpHandlerArgsFor<typeof HttpScaleModule, "typedScaleHttp">,
    Schema.Schema.Type<typeof HttpRequest>
  >
>

type _TypedHttpSuccess = Assert<
  IsEqual<
    Stdb.HttpHandlerSuccessFor<typeof HttpScaleModule, "typedScaleHttp">,
    Schema.Schema.Type<typeof HttpResponse>
  >
>

type _AnyGroupCallableAssignable = Assert<
  IsAssignable<typeof ChainedSingleAddGroup, AnyGroup>
>

type _AnyGroupHttpAssignable = Assert<
  IsAssignable<typeof MergedHttpGroup, AnyGroup>
>

type _LegacyCallableShapeAssignable = Assert<
  IsAssignable<
    typeof ChainedSingleAddGroup,
    Stdb.StdbGroup<string, Stdb.AnyCallableDecl>
  >
>

type _LegacyHttpShapeAssignable = Assert<
  IsAssignable<
    typeof MergedHttpGroup,
    Stdb.StdbHttpGroup<string, Stdb.AnyHttpRouteDecl>
  >
>

void WideScaleGroup09Handlers
void ChainedHandlers
