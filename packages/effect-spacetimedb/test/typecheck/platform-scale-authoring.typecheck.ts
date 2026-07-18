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

const PlatformScaleGroup00 = group42("PlatformScaleGroup00", "scale00")
const PlatformScaleGroup01 = group42("PlatformScaleGroup01", "scale01")
const PlatformScaleGroup02 = group42("PlatformScaleGroup02", "scale02")
const PlatformScaleGroup03 = group42("PlatformScaleGroup03", "scale03")
const PlatformScaleGroup04 = group42("PlatformScaleGroup04", "scale04")
const PlatformScaleGroup05 = group42("PlatformScaleGroup05", "scale05")
const PlatformScaleGroup06 = group42("PlatformScaleGroup06", "scale06")
const PlatformScaleGroup07 = group42("PlatformScaleGroup07", "scale07")
const PlatformScaleGroup08 = group42("PlatformScaleGroup08", "scale08")
const PlatformScaleGroup09 = group42("PlatformScaleGroup09", "scale09")
const PlatformScaleGroup10 = group42("PlatformScaleGroup10", "scale10")
const PlatformScaleGroup11 = group42("PlatformScaleGroup11", "scale11")
const PlatformScaleGroup12 = group42("PlatformScaleGroup12", "scale12")
const PlatformScaleGroup13 = group42("PlatformScaleGroup13", "scale13")
const PlatformScaleGroup14 = group42("PlatformScaleGroup14", "scale14")
const PlatformScaleGroup15 = group42("PlatformScaleGroup15", "scale15")
const PlatformScaleGroup16 = group42("PlatformScaleGroup16", "scale16")
const PlatformScaleGroup17 = group42("PlatformScaleGroup17", "scale17")
const PlatformScaleGroup18 = group42("PlatformScaleGroup18", "scale18")

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

const PlatformScaleScheduled = Stdb.StdbGroup.make(
  "PlatformScaleScheduled",
).add(
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

const PlatformScaleModule = Stdb.StdbModule.make("platform_scale_probe", {})
  .addTables(ScaleScheduledA, ScaleScheduledB)
  .add(
    PlatformScaleGroup00,
    PlatformScaleGroup01,
    PlatformScaleGroup02,
    PlatformScaleGroup03,
    PlatformScaleGroup04,
    PlatformScaleGroup05,
    PlatformScaleGroup06,
    PlatformScaleGroup07,
    PlatformScaleGroup08,
    PlatformScaleGroup09,
    PlatformScaleGroup10,
    PlatformScaleGroup11,
    PlatformScaleGroup12,
    PlatformScaleGroup13,
    PlatformScaleGroup14,
    PlatformScaleGroup15,
    PlatformScaleGroup16,
    PlatformScaleGroup17,
    PlatformScaleGroup18,
    PlatformScaleScheduled,
    MixedSectionGroup,
  )

const ModuleChainArm = Stdb.StdbModule.make("platform_scale_chain_probe", {})
  .addTables(ScaleScheduledA, ScaleScheduledB)
  .add(PlatformScaleGroup00)
  .add(PlatformScaleGroup01)
  .add(PlatformScaleGroup02)
  .add(PlatformScaleGroup03)
  .add(PlatformScaleGroup04)
  .add(PlatformScaleGroup05)
  .add(PlatformScaleGroup06)
  .add(PlatformScaleGroup07)
  .add(PlatformScaleGroup08)
  .add(PlatformScaleGroup09)
  .add(PlatformScaleGroup10)
  .add(PlatformScaleGroup11)
  .add(PlatformScaleGroup12)
  .add(PlatformScaleGroup13)
  .add(PlatformScaleGroup14)
  .add(PlatformScaleGroup15)
  .add(PlatformScaleGroup16)
  .add(PlatformScaleGroup17)
  .add(PlatformScaleGroup18)
  .add(PlatformScaleScheduled)
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

const PlatformScaleGroup09Handlers: Stdb.GroupCheckedHandlers<
  typeof PlatformScaleModule,
  "PlatformScaleGroup09"
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

type PlatformScaleGroups =
  | typeof PlatformScaleGroup00
  | typeof PlatformScaleGroup01
  | typeof PlatformScaleGroup02
  | typeof PlatformScaleGroup03
  | typeof PlatformScaleGroup04
  | typeof PlatformScaleGroup05
  | typeof PlatformScaleGroup06
  | typeof PlatformScaleGroup07
  | typeof PlatformScaleGroup08
  | typeof PlatformScaleGroup09
  | typeof PlatformScaleGroup10
  | typeof PlatformScaleGroup11
  | typeof PlatformScaleGroup12
  | typeof PlatformScaleGroup13
  | typeof PlatformScaleGroup14
  | typeof PlatformScaleGroup15
  | typeof PlatformScaleGroup16
  | typeof PlatformScaleGroup17
  | typeof PlatformScaleGroup18
  | typeof PlatformScaleScheduled

type _SchedulePairsOfGroups = Assert<
  IsEqual<
    SchedulePairsOf<PlatformScaleGroups>,
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

type PlatformScaleGroupNames = Stdb.GroupNames<typeof PlatformScaleModule>
type _PlatformScaleBoundaryNames = Assert<
  IsEqual<
    Extract<
      PlatformScaleGroupNames,
      "PlatformScaleGroup00" | "PlatformScaleGroup18"
    >,
    "PlatformScaleGroup00" | "PlatformScaleGroup18"
  >
>

type _ModuleChainBoundaryNames = Assert<
  IsEqual<
    Extract<
      Stdb.GroupNames<typeof ModuleChainArm>,
      "PlatformScaleGroup00" | "MixedSection"
    >,
    "PlatformScaleGroup00" | "MixedSection"
  >
>

type _PlatformScaleTableIndex = Assert<
  IsEqual<
    (typeof PlatformScaleModule)["spec"]["tables"]["scaleScheduledA"],
    typeof ScaleScheduledA
  >
>

type _PlatformScaleGroup09HandlersAssignable = Assert<
  IsAssignable<
    typeof PlatformScaleGroup09Handlers,
    Stdb.GroupCheckedHandlers<
      typeof PlatformScaleModule,
      "PlatformScaleGroup09"
    >
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
    Expand<Stdb.ProcedureArgsFor<typeof PlatformScaleModule, "mixedProcedure">>,
    { readonly value: string }
  >
>

type _MixedProcedureSuccess = Assert<
  IsEqual<
    Stdb.ProcedureSuccessFor<typeof PlatformScaleModule, "mixedProcedure">,
    string
  >
>

type _MixedViewSuccess = Assert<
  IsEqual<
    Extract<
      Stdb.ViewSuccessFor<typeof PlatformScaleModule, "mixedView">,
      string
    >,
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

void PlatformScaleGroup09Handlers
void ChainedHandlers
